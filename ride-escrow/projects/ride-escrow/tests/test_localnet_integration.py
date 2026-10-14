"""Real on-chain integration tests using algokit-utils against Algorand LocalNet."""

import hashlib
import pytest
from algosdk.encoding import decode_address
import algokit_utils
from algokit_utils import AlgorandClient
from smart_contracts.artifacts.ride_escrow.ride_escrow_client import (
    RideEscrowClient,
    RideEscrowFactory,
)

BOX_MBR = 47_700
MIN_FARE = 100_000


def get_box_key(rider_address: str, ride_id: str) -> bytes:
    return hashlib.sha256(decode_address(rider_address) + ride_id.encode("utf-8")).digest()


def get_box_ref(rider_address: str, ride_id: str) -> algokit_utils.BoxReference:
    return algokit_utils.BoxReference(app_id=0, name=get_box_key(rider_address, ride_id))


import time


def advance_rounds(algorand: AlgorandClient, n: int) -> None:
    dispenser = algorand.account.localnet_dispenser()
    for i in range(n):
        algorand.send.payment(
            algokit_utils.PaymentParams(
                sender=dispenser.address,
                receiver=dispenser.address,
                amount=algokit_utils.AlgoAmount(micro_algo=0),
                note=f"adv-{time.time_ns()}-{i}".encode(),
            )
        )


@pytest.fixture(scope="module")
def algorand() -> AlgorandClient:
    client = AlgorandClient.default_localnet()
    try:
        client.client.algod.status()
    except Exception as e:
        pytest.fail(f"Algorand LocalNet is not reachable at http://localhost:4001: {e}")
    return client


@pytest.fixture(scope="module")
def dispenser(algorand: AlgorandClient):
    return algorand.account.localnet_dispenser()


@pytest.fixture
def test_accounts(algorand: AlgorandClient, dispenser):
    creator = algorand.account.random()
    rider = algorand.account.random()
    driver = algorand.account.random()
    for acc in [creator, rider, driver]:
        algorand.send.payment(
            algokit_utils.PaymentParams(
                sender=dispenser.address,
                receiver=acc.address,
                amount=algokit_utils.AlgoAmount(micro_algo=20_000_000),
            )
        )
    return creator, rider, driver


@pytest.fixture
def deployed_app(algorand: AlgorandClient, test_accounts):
    creator, _, _ = test_accounts
    factory = algorand.client.get_typed_app_factory(RideEscrowFactory, default_sender=creator.address)
    app_client, _ = factory.send.create.create(args=(10, 20))

    # Fund app account with 0.2 ALGO (200,000 microAlgos) at setup as required
    algorand.send.payment(
        algokit_utils.PaymentParams(
            sender=creator.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=200_000),
        )
    )
    return app_client


def test_real_app_account_min_balance_rises_and_returns(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """The app account's min balance increases by exactly BOX_MBR after book_trip and returns after payout."""
    creator, rider, driver = test_accounts
    app_client = deployed_app

    initial_mbr = algorand.account.get_information(app_client.app_address).min_balance.micro_algo
    assert initial_mbr == 100_000  # Base account MBR

    ride_id = "test-mbr-lifecycle"
    box_ref = get_box_ref(rider.address, ride_id)
    fare = 150_000
    total_pay = fare + BOX_MBR

    pay_txn = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )

    # book_trip creates box
    app_client.send.book_trip(
        args=(ride_id, driver.address, pay_txn),
        params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]),
    )

    booked_mbr = algorand.account.get_information(app_client.app_address).min_balance.micro_algo
    assert booked_mbr == initial_mbr + BOX_MBR, f"MBR increase must be {BOX_MBR}"

    # complete ride
    app_client.send.start_ride(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]),
    )
    app_client.send.confirm_complete(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(
            sender=rider.address,
            signer=rider.signer,
            box_references=[box_ref],
            extra_fee=algokit_utils.AlgoAmount(micro_algo=2000),
        ),
    )

    final_mbr = algorand.account.get_information(app_client.app_address).min_balance.micro_algo
    assert final_mbr == initial_mbr, "MBR must return to baseline after box deletion"


def test_real_happy_path_balance_deltas(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """Happy path with real balance deltas for rider, driver, and app account."""
    _, rider, driver = test_accounts
    app_client = deployed_app

    ride_id = "test-real-happy-path"
    box_ref = get_box_ref(rider.address, ride_id)
    fare = 120_000
    total_pay = fare + BOX_MBR

    app_initial = algorand.account.get_information(app_client.app_address).amount.micro_algo
    driver_initial = algorand.account.get_information(driver.address).amount.micro_algo
    rider_initial = algorand.account.get_information(rider.address).amount.micro_algo

    pay_txn = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )

    # Book trip (rider pays fare + BOX_MBR + 1000 fee for pay_txn + 1000 fee for app call)
    app_client.send.book_trip(
        args=(ride_id, driver.address, pay_txn),
        params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]),
    )

    # Start and Dropoff by driver (2 transactions, each 1000 fee)
    app_client.send.start_ride(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]),
    )
    app_client.send.mark_dropoff(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]),
    )

    # Confirm complete by rider (outer fee 3000)
    app_client.send.confirm_complete(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(
            sender=rider.address,
            signer=rider.signer,
            box_references=[box_ref],
            extra_fee=algokit_utils.AlgoAmount(micro_algo=2000),
        ),
    )

    app_final = algorand.account.get_information(app_client.app_address).amount.micro_algo
    driver_final = algorand.account.get_information(driver.address).amount.micro_algo
    rider_final = algorand.account.get_information(rider.address).amount.micro_algo

    # Driver receives exact fare, minus 2000 in tx fees for start and dropoff
    assert driver_final - driver_initial == fare - 2000

    # Rider pays fare + 5000 in network fees (pay: 1000, book: 1000, confirm: 3000), MBR is fully refunded
    assert rider_initial - rider_final == fare + 5000

    # App account returns exactly to its starting balance (all escrow funds and MBR paid out)
    assert app_final == app_initial


def test_real_confirm_complete_fee_threshold(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """confirm_complete with a 2,000 µALGO outer fee must fail; with 3,000 it must pass."""
    _, rider, driver = test_accounts
    app_client = deployed_app

    ride_id = "test-confirm-fee"
    box_ref = get_box_ref(rider.address, ride_id)
    fare = 100_000
    total_pay = fare + BOX_MBR

    pay_txn = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )
    app_client.send.book_trip(
        args=(ride_id, driver.address, pay_txn),
        params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]),
    )
    app_client.send.start_ride(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]),
    )

    # 1. Outer fee = 2,000 µALGO (extra_fee = 1000) -> must fail (needs 3000 for 2 inner payments)
    with pytest.raises(Exception):
        app_client.send.confirm_complete(
            args=(rider.address, ride_id),
            params=algokit_utils.CommonAppCallParams(
                sender=rider.address,
                signer=rider.signer,
                box_references=[box_ref],
                extra_fee=algokit_utils.AlgoAmount(micro_algo=1000),
            ),
        )

    # 2. Outer fee = 3,000 µALGO (extra_fee = 2000) -> must pass
    res = app_client.send.confirm_complete(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(
            sender=rider.address,
            signer=rider.signer,
            box_references=[box_ref],
            extra_fee=algokit_utils.AlgoAmount(micro_algo=2000),
        ),
    )
    assert res.tx_id is not None


def test_real_cancel_trip_fee_threshold(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """cancel_trip with 1,000 must fail; with 2,000 must pass."""
    _, rider, driver = test_accounts
    app_client = deployed_app

    ride_id = "test-cancel-fee"
    box_ref = get_box_ref(rider.address, ride_id)
    fare = 100_000
    total_pay = fare + BOX_MBR

    pay_txn = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )
    app_client.send.book_trip(
        args=(ride_id, driver.address, pay_txn),
        params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]),
    )

    # 1. Outer fee = 1,000 µALGO (default fee, no extra_fee) -> must fail (needs 2000 for 1 inner refund payment)
    with pytest.raises(Exception):
        app_client.send.cancel_trip(
            args=(rider.address, ride_id),
            params=algokit_utils.CommonAppCallParams(
                sender=rider.address,
                signer=rider.signer,
                box_references=[box_ref],
            ),
        )

    # 2. Outer fee = 2,000 µALGO (extra_fee = 1000) -> must pass
    res = app_client.send.cancel_trip(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(
            sender=rider.address,
            signer=rider.signer,
            box_references=[box_ref],
            extra_fee=algokit_utils.AlgoAmount(micro_algo=1000),
        ),
    )
    assert res.tx_id is not None


def test_real_book_trip_rekey_and_close_remainder_must_fail(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """book_trip with rekey_to set, or pay.close_remainder_to set, must fail."""
    creator, rider, driver = test_accounts
    app_client = deployed_app

    fare = 100_000
    total_pay = fare + BOX_MBR

    # 1. pay.close_remainder_to set
    ride_id1 = "test-close-rem"
    box_ref1 = get_box_ref(rider.address, ride_id1)
    bad_pay1 = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
            close_remainder_to=creator.address,
        )
    )
    with pytest.raises(Exception):
        app_client.send.book_trip(
            args=(ride_id1, driver.address, bad_pay1),
            params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref1]),
        )

    # 2. app call with rekey_to set
    ride_id2 = "test-rekey-app"
    box_ref2 = get_box_ref(rider.address, ride_id2)
    normal_pay = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )
    with pytest.raises(Exception):
        app_client.send.book_trip(
            args=(ride_id2, driver.address, normal_pay),
            params=algokit_utils.CommonAppCallParams(
                sender=rider.address,
                signer=rider.signer,
                box_references=[box_ref2],
                rekey_to=creator.address,
            ),
        )


def test_real_two_book_trip_sharing_one_payment_fails(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """two book_trip calls sharing one payment in one group must fail."""
    _, rider, driver = test_accounts
    app_client = deployed_app

    ride_id1 = "test-share-1"
    ride_id2 = "test-share-2"
    box_ref1 = get_box_ref(rider.address, ride_id1)
    box_ref2 = get_box_ref(rider.address, ride_id2)

    fare = 100_000
    total_pay = fare + BOX_MBR

    pay_txn = algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
        )
    )

    # Try building a composer group: [pay_txn, book_trip(1), book_trip(2)]
    composer = algorand.new_group()
    composer.add_payment(
        algokit_utils.PaymentParams(
            sender=rider.address,
            receiver=app_client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=total_pay),
            signer=rider.signer,
        )
    )
    # The first call uses the payment
    composer.add_app_call_method_call(
        app_client.params.book_trip(
            args=(ride_id1, driver.address, pay_txn),
            params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref1]),
        )
    )
    # The second call attempts to reuse the same payment transaction
    composer.add_app_call_method_call(
        app_client.params.book_trip(
            args=(ride_id2, driver.address, pay_txn),
            params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref2]),
        )
    )

    with pytest.raises(Exception):
        composer.send()


def test_real_update_and_delete_application_must_both_fail(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """UpdateApplication and DeleteApplication from the creator must both fail."""
    creator, _, _ = test_accounts
    app_client = deployed_app

    # 1. UpdateApplication must fail
    with pytest.raises(Exception):
        algorand.send.app_update_application(
            algokit_utils.AppUpdateParams(
                app_id=app_client.app_id,
                sender=creator.address,
                approval_program=algorand.client.algod.compile("int 1")["result"],
                clear_state_program=algorand.client.algod.compile("int 1")["result"],
                signer=creator.signer,
            )
        )

    # 2. DeleteApplication must fail
    with pytest.raises(Exception):
        algorand.send.app_delete_application(
            algokit_utils.AppDeleteParams(
                app_id=app_client.app_id,
                sender=creator.address,
                signer=creator.signer,
            )
        )


def test_real_conservation_of_funds_5_rides(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """Conservation of funds across 5 rides with different endings: app ends at exact initial funding."""
    creator, rider, driver = test_accounts
    app_client = deployed_app

    initial_app_funding = algorand.account.get_information(app_client.app_address).amount.micro_algo
    assert initial_app_funding == 200_000

    # Ending 1: Complete (happy path)
    r1 = "conserve-1-complete"
    b1 = get_box_ref(rider.address, r1)
    f1 = 110_000
    p1 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=f1 + BOX_MBR)))
    app_client.send.book_trip(args=(r1, driver.address, p1), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b1]))
    app_client.send.start_ride(args=(rider.address, r1), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b1]))
    app_client.send.mark_dropoff(args=(rider.address, r1), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b1]))
    app_client.send.confirm_complete(args=(rider.address, r1), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b1], extra_fee=algokit_utils.AlgoAmount(micro_algo=2000)))

    # Ending 2: Cancel (refund rider)
    r2 = "conserve-2-cancel"
    b2 = get_box_ref(rider.address, r2)
    f2 = 120_000
    p2 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=f2 + BOX_MBR)))
    app_client.send.book_trip(args=(r2, driver.address, p2), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b2]))
    app_client.send.cancel_trip(args=(rider.address, r2), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b2], extra_fee=algokit_utils.AlgoAmount(micro_algo=1000)))

    # Ending 3: Claim after timeout
    r3 = "conserve-3-claim"
    b3 = get_box_ref(rider.address, r3)
    f3 = 130_000
    p3 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=f3 + BOX_MBR)))
    app_client.send.book_trip(args=(r3, driver.address, p3), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b3]))
    app_client.send.start_ride(args=(rider.address, r3), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b3]))
    app_client.send.mark_dropoff(args=(rider.address, r3), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b3]))
    advance_rounds(algorand, 12)  # timeout is 10 rounds
    app_client.send.claim_after_timeout(args=(rider.address, r3), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b3], extra_fee=algokit_utils.AlgoAmount(micro_algo=2000)))

    # Ending 4: Dispute -> Pay Driver
    r4 = "conserve-4-disp-driver"
    b4 = get_box_ref(rider.address, r4)
    f4 = 140_000
    p4 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=f4 + BOX_MBR)))
    app_client.send.book_trip(args=(r4, driver.address, p4), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b4]))
    app_client.send.start_ride(args=(rider.address, r4), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b4]))
    app_client.send.raise_dispute(args=(rider.address, r4), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b4]))
    app_client.send.resolve_dispute(args=(rider.address, r4, True), params=algokit_utils.CommonAppCallParams(sender=creator.address, signer=creator.signer, box_references=[b4], extra_fee=algokit_utils.AlgoAmount(micro_algo=2000)))

    # Ending 5: Dispute -> Refund Rider
    r5 = "conserve-5-disp-rider"
    b5 = get_box_ref(rider.address, r5)
    f5 = 150_000
    p5 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=f5 + BOX_MBR)))
    app_client.send.book_trip(args=(r5, driver.address, p5), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b5]))
    app_client.send.start_ride(args=(rider.address, r5), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[b5]))
    app_client.send.raise_dispute(args=(rider.address, r5), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[b5]))
    app_client.send.resolve_dispute(args=(rider.address, r5, False), params=algokit_utils.CommonAppCallParams(sender=creator.address, signer=creator.signer, box_references=[b5], extra_fee=algokit_utils.AlgoAmount(micro_algo=1000)))

    final_app_balance = algorand.account.get_information(app_client.app_address).amount.micro_algo
    assert final_app_balance == initial_app_funding == 200_000, "Conservation of funds violated"


def test_real_boundary_claim_and_dispute_exact_rounds(algorand: AlgorandClient, test_accounts):
    """claim_after_timeout and raise_dispute at stored+timeout-1 and stored+timeout."""
    creator, rider, driver = test_accounts
    factory = algorand.client.get_typed_app_factory(RideEscrowFactory, default_sender=creator.address)
    timeout = 6
    app_client, _ = factory.send.create.create(args=(timeout, 20))
    algorand.send.payment(algokit_utils.PaymentParams(sender=creator.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=200_000)))

    ride_id = "test-boundary-ride"
    box_ref = get_box_ref(rider.address, ride_id)
    fare = 100_000
    p = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=fare + BOX_MBR)))
    app_client.send.book_trip(args=(ride_id, driver.address, p), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]))
    app_client.send.start_ride(args=(rider.address, ride_id), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]))

    res = app_client.send.mark_dropoff(args=(rider.address, ride_id), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref]))
    drop_round = res.confirmation["confirmed-round"]

    # Target execution round: drop_round + timeout - 1
    # On Algorand, a transaction submitted when last-round is R executes in round R + 1.
    # Therefore, to execute at (drop_round + timeout - 1), we need last-round == (drop_round + timeout - 2).
    curr = algorand.client.algod.status()["last-round"]
    needed = (drop_round + timeout - 2) - curr
    if needed > 0:
        advance_rounds(algorand, needed)

    # At drop_round + timeout - 1:
    # 1. claim_after_timeout MUST FAIL
    with pytest.raises(Exception):
        app_client.send.claim_after_timeout(
            args=(rider.address, ride_id),
            params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref], extra_fee=algokit_utils.AlgoAmount(micro_algo=2000)),
        )

    # 2. raise_dispute MUST SUCCEED (before timeout)
    disp_res = app_client.send.raise_dispute(
        args=(rider.address, ride_id),
        params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref]),
    )
    assert disp_res.confirmation["confirmed-round"] == drop_round + timeout - 1

    # Now test the boundary on a second ride for stored + timeout
    ride_id2 = "test-boundary-ride-2"
    box_ref2 = get_box_ref(rider.address, ride_id2)
    p2 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=fare + BOX_MBR)))
    app_client.send.book_trip(args=(ride_id2, driver.address, p2), params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref2]))
    app_client.send.start_ride(args=(rider.address, ride_id2), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref2]))
    res2 = app_client.send.mark_dropoff(args=(rider.address, ride_id2), params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref2]))
    drop_round2 = res2.confirmation["confirmed-round"]

    # Target execution round: drop_round2 + timeout
    # To execute at (drop_round2 + timeout), we need last-round == (drop_round2 + timeout - 1).
    curr2 = algorand.client.algod.status()["last-round"]
    needed2 = (drop_round2 + timeout - 1) - curr2
    if needed2 > 0:
        advance_rounds(algorand, needed2)

    # At drop_round2 + timeout:
    # 1. raise_dispute MUST FAIL (timeout has expired)
    with pytest.raises(Exception):
        app_client.send.raise_dispute(
            args=(rider.address, ride_id2),
            params=algokit_utils.CommonAppCallParams(sender=rider.address, signer=rider.signer, box_references=[box_ref2]),
        )

    # 2. claim_after_timeout MUST SUCCEED
    claim_res = app_client.send.claim_after_timeout(
        args=(rider.address, ride_id2),
        params=algokit_utils.CommonAppCallParams(sender=driver.address, signer=driver.signer, box_references=[box_ref2], extra_fee=algokit_utils.AlgoAmount(micro_algo=2000)),
    )
    assert claim_res.tx_id is not None


def test_real_squatting_creates_separate_boxes(algorand: AlgorandClient, test_accounts, deployed_app: RideEscrowClient):
    """Squatting: a different account booking with the victim's ride_id creates a separate box."""
    _, victim_rider, driver = test_accounts
    squatter = algorand.account.random()
    dispenser = algorand.account.localnet_dispenser()
    algorand.send.payment(algokit_utils.PaymentParams(sender=dispenser.address, receiver=squatter.address, amount=algokit_utils.AlgoAmount(micro_algo=5_000_000)))

    app_client = deployed_app
    shared_ride_id = "shared-uuid-001"

    box_ref_victim = get_box_ref(victim_rider.address, shared_ride_id)
    box_ref_squatter = get_box_ref(squatter.address, shared_ride_id)

    # Box keys must be distinct because rider addresses are hashed into key
    assert box_ref_victim.name != box_ref_squatter.name

    fare1 = 100_000
    p1 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=victim_rider.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=fare1 + BOX_MBR)))
    app_client.send.book_trip(
        args=(shared_ride_id, driver.address, p1),
        params=algokit_utils.CommonAppCallParams(sender=victim_rider.address, signer=victim_rider.signer, box_references=[box_ref_victim]),
    )

    fare2 = 250_000
    p2 = algorand.create_transaction.payment(algokit_utils.PaymentParams(sender=squatter.address, receiver=app_client.app_address, amount=algokit_utils.AlgoAmount(micro_algo=fare2 + BOX_MBR)))
    app_client.send.book_trip(
        args=(shared_ride_id, driver.address, p2),
        params=algokit_utils.CommonAppCallParams(sender=squatter.address, signer=squatter.signer, box_references=[box_ref_squatter]),
    )

    # Verify both boxes coexist with their distinct fares
    victim_ride = app_client.send.get_ride(
        args=(victim_rider.address, shared_ride_id),
        params=algokit_utils.CommonAppCallParams(box_references=[box_ref_victim]),
    )
    squatter_ride = app_client.send.get_ride(
        args=(squatter.address, shared_ride_id),
        params=algokit_utils.CommonAppCallParams(box_references=[box_ref_squatter]),
    )

    assert victim_ride.abi_return.amount == fare1
    assert squatter_ride.abi_return.amount == fare2
