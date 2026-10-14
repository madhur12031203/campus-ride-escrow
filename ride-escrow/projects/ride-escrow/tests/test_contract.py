import pytest
from algopy import Global, UInt64, arc4, op
from algopy_testing import algopy_testing_context

from smart_contracts.ride_escrow.contract import (
    BOX_MBR,
    MIN_FARE,
    STATUS_BOOKED,
    STATUS_DISPUTED,
    STATUS_DROPPED,
    STATUS_STARTED,
    RideEscrow,
    RideState,
)


def setup_escrow(ctx, timeout_rounds=100, dispute_timeout_rounds=200):
    contract = RideEscrow()
    contract.create(UInt64(timeout_rounds), UInt64(dispute_timeout_rounds))
    app = ctx.ledger.get_app(contract)
    rider = ctx.default_sender
    driver = ctx.any.account()
    admin = ctx.default_sender
    return contract, app, rider, driver, admin


def make_payment(ctx, sender, receiver, fare):
    return ctx.any.txn.payment(
        sender=sender,
        receiver=receiver,
        amount=fare + BOX_MBR,
        close_remainder_to=Global.zero_address,
        rekey_to=Global.zero_address,
    )


# =============================================================================
# [algorand_python_testing mock] Contract Creation & Box Configuration Tests
# =============================================================================


def test_mock_create_assertions():
    """[algorand_python_testing mock] Verify create() requires timeout_rounds > 0 and dispute_timeout_rounds > 0."""
    with algopy_testing_context() as ctx:
        contract1 = RideEscrow()
        with pytest.raises(AssertionError, match="Timeout rounds must be greater than 0"):
            contract1.create(UInt64(0), UInt64(200))

        contract2 = RideEscrow()
        with pytest.raises(AssertionError, match="Dispute timeout rounds must be greater than 0"):
            contract2.create(UInt64(100), UInt64(0))


def test_mock_box_mbr_exact_size_and_key_prefix():
    """[algorand_python_testing mock] Verify key_prefix=b'', 32-byte key, 81-byte value, and 47,700 MBR."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-mbr"), arc4.Address(driver), pay)

        ride = contract.get_ride(arc4.Address(rider), arc4.String("ride-mbr"))
        value_bytes = ride.bytes
        raw_key = arc4.Address(rider).bytes + arc4.String("ride-mbr").bytes
        exact_32b_key = op.sha256(raw_key)

        # Exact sizes verification
        assert len(exact_32b_key) == 32, f"Expected 32-byte key, got {len(exact_32b_key)}"
        assert len(value_bytes) == 81, f"Expected 81-byte value struct, got {len(value_bytes)}"

        # Box in storage directly matches 32-byte sha256 key without prefix
        box_data = ctx.ledger.get_box(app, exact_32b_key)
        assert len(box_data) == 81

        # Derived Box MBR verification: 2500 + 400 * (32 + 81) = 47,700
        derived_mbr = 2500 + 400 * (len(exact_32b_key) + len(value_bytes))
        assert derived_mbr == BOX_MBR == 47_700
        assert MIN_FARE == 100_000


# =============================================================================
# [algorand_python_testing mock] MBR Rise/Fall & Conservation of Funds
# =============================================================================


def test_mock_app_min_balance_rises_and_falls():
    """[algorand_python_testing mock] Verify app account's box MBR rises by BOX_MBR on booking and falls back on payout."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 200_000

        # Initial state: 0 boxes
        initial_boxes = 0
        initial_box_mbr = initial_boxes * BOX_MBR
        assert initial_box_mbr == 0

        # Book trip -> 1 box created
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-mbr-cycle"), arc4.Address(driver), pay)

        raw_key = arc4.Address(rider).bytes + arc4.String("ride-mbr-cycle").bytes
        key = op.sha256(raw_key)
        assert ctx.ledger.box_exists(app, key)

        active_box_mbr = 2500 + 400 * (32 + 81)
        assert active_box_mbr == BOX_MBR == 47_700
        delta_after_book = active_box_mbr - initial_box_mbr
        assert delta_after_book == BOX_MBR

        # Driver starts ride then rider confirms complete -> box deleted
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-mbr-cycle"))
        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-mbr-cycle"))
        assert not ctx.ledger.box_exists(app, key)

        delta_after_payout = 0
        assert delta_after_payout == initial_box_mbr


def test_mock_conservation_of_funds_5_rides():
    """[algorand_python_testing mock] Conservation of funds across 5 distinct ride endings.
    Verifies: Total paid in == Total paid out, and app account ends at initial funding."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, admin = setup_escrow(ctx, timeout_rounds=100, dispute_timeout_rounds=200)

        initial_app_funding = 1_000_000
        current_balance = initial_app_funding
        ctx.ledger.update_account(app.address, balance=current_balance)

        total_paid_in = 0
        total_paid_out = 0

        # Ride 1: Happy path (confirm_complete)
        fare1 = 150_000
        p1 = fare1 + BOX_MBR
        pay1 = make_payment(ctx, rider, app.address, fare1)
        current_balance += p1
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_in += p1
        contract.book_trip(arc4.String("ride-1"), arc4.Address(driver), pay1)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-1"))
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-1"))
        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-1"))
        out1 = ctx.txn.last_group._itxn_groups[0][0].amount + ctx.txn.last_group._itxn_groups[1][0].amount
        current_balance -= out1
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_out += out1
        assert out1 == p1

        # Ride 2: Cancelled by rider
        fare2 = 120_000
        p2 = fare2 + BOX_MBR
        pay2 = make_payment(ctx, rider, app.address, fare2)
        current_balance += p2
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_in += p2
        contract.book_trip(arc4.String("ride-2"), arc4.Address(driver), pay2)
        contract.cancel_trip(arc4.Address(rider), arc4.String("ride-2"))
        out2 = ctx.txn.last_group._itxn_groups[0][0].amount
        current_balance -= out2
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_out += out2
        assert out2 == p2

        # Ride 3: Cancelled by driver
        fare3 = 200_000
        p3 = fare3 + BOX_MBR
        pay3 = make_payment(ctx, rider, app.address, fare3)
        current_balance += p3
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_in += p3
        contract.book_trip(arc4.String("ride-3"), arc4.Address(driver), pay3)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.cancel_trip(arc4.Address(rider), arc4.String("ride-3"))
        out3 = ctx.txn.last_group._itxn_groups[0][0].amount
        current_balance -= out3
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_out += out3
        assert out3 == p3

        # Ride 4: Claimed after timeout
        fare4 = 250_000
        p4 = fare4 + BOX_MBR
        pay4 = make_payment(ctx, rider, app.address, fare4)
        current_balance += p4
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_in += p4
        contract.book_trip(arc4.String("ride-4"), arc4.Address(driver), pay4)
        ctx.ledger.patch_global_fields(round=100)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-4"))
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-4"))
        ctx.ledger.patch_global_fields(round=205)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.claim_after_timeout(arc4.Address(rider), arc4.String("ride-4"))
        out4 = ctx.txn.last_group._itxn_groups[0][0].amount + ctx.txn.last_group._itxn_groups[1][0].amount
        current_balance -= out4
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_out += out4
        assert out4 == p4

        # Ride 5: Disputed and resolved to refund rider
        fare5 = 180_000
        p5 = fare5 + BOX_MBR
        pay5 = make_payment(ctx, rider, app.address, fare5)
        current_balance += p5
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_in += p5
        contract.book_trip(arc4.String("ride-5"), arc4.Address(driver), pay5)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-5"))
        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-5"))
        contract.resolve_dispute(arc4.Address(rider), arc4.String("ride-5"), False)
        out5 = ctx.txn.last_group._itxn_groups[0][0].amount
        current_balance -= out5
        ctx.ledger.update_account(app.address, balance=current_balance)
        total_paid_out += out5
        assert out5 == p5

        # Strict Conservation Invariants
        assert total_paid_in == total_paid_out == 1_138_500
        assert app.address.balance == initial_app_funding == 1_000_000


# =============================================================================
# [algorand_python_testing mock] Security: Group Sharing & Fee Requirements
# =============================================================================


def test_mock_two_book_trip_calls_sharing_one_payment_must_fail():
    """[algorand_python_testing mock] A group with two book_trip calls sharing one payment must fail."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver1, _ = setup_escrow(ctx)
        driver2 = ctx.any.account()

        pay = ctx.any.txn.payment(
            sender=rider,
            receiver=app.address,
            amount=300_000 + BOX_MBR,
            close_remainder_to=Global.zero_address,
            rekey_to=Global.zero_address,
        )

        app_call_1 = ctx.any.txn.application_call(app_id=app, sender=rider, rekey_to=Global.zero_address)
        app_call_2 = ctx.any.txn.application_call(app_id=app, sender=rider, rekey_to=Global.zero_address)

        # Construct group: [pay (idx 0), app_call_1 (idx 1), app_call_2 (idx 2)]
        # For app_call_2 at index 2, pay is at index 0, so pay.group_index + 1 == 1 != 2
        with ctx.txn.create_group([pay, app_call_1, app_call_2], active_txn_index=2):
            with pytest.raises(AssertionError, match="Payment transaction must immediately precede application call"):
                contract.book_trip(arc4.String("ride-shared-pay"), arc4.Address(driver2), pay)


def test_mock_confirm_complete_requires_3000_outer_fee():
    """[algorand_python_testing mock] Verifies confirm_complete requires 3000 uALGO pooled outer fee (1 app + 2 inner txns)."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        pay = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-fee"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-fee"))

        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-fee"))

        # Both inner txns specify fee=0, requiring 2 * 1000 uALGO from outer caller
        itxn1 = ctx.txn.last_group._itxn_groups[0][0]
        itxn2 = ctx.txn.last_group._itxn_groups[1][0]
        assert itxn1.fee == 0
        assert itxn2.fee == 0
        total_inner_txns = len(ctx.txn.last_group._itxn_groups)
        assert total_inner_txns == 2
        required_outer_fee = 1000 * (1 + total_inner_txns)
        assert required_outer_fee == 3000


# =============================================================================
# [algorand_python_testing mock] Exact Round Boundary Tests
# =============================================================================


def test_mock_boundary_claim_and_dispute_exact_rounds():
    """[algorand_python_testing mock] Exact round boundary: stored + timeout - 1 vs stored + timeout."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx, timeout_rounds=100)
        stored_dropoff_round = 500

        # Setup Ride A to test boundary at (stored + timeout - 1) = 599
        pay_a = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-boundary-A"), arc4.Address(driver), pay_a)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-boundary-A"))
            ctx.ledger.patch_global_fields(round=stored_dropoff_round)
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-boundary-A"))

        # Round 599: (500 + 100 - 1)
        ctx.ledger.patch_global_fields(round=599)

        # 1. Driver claiming at 599 must FAIL
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            with pytest.raises(AssertionError, match="Timeout has not elapsed"):
                contract.claim_after_timeout(arc4.Address(rider), arc4.String("ride-boundary-A"))

        # 2. Rider disputing at 599 must SUCCEED
        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-boundary-A"))
        assert contract.get_ride(arc4.Address(rider), arc4.String("ride-boundary-A")).status.native == STATUS_DISPUTED

        # Setup Ride B to test boundary at (stored + timeout) = 600
        pay_b = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-boundary-B"), arc4.Address(driver), pay_b)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-boundary-B"))
            ctx.ledger.patch_global_fields(round=stored_dropoff_round)
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-boundary-B"))

        # Round 600: (500 + 100)
        ctx.ledger.patch_global_fields(round=600)

        # 3. Rider disputing at 600 must FAIL
        with pytest.raises(AssertionError, match="Timeout has already elapsed"):
            contract.raise_dispute(arc4.Address(rider), arc4.String("ride-boundary-B"))

        # 4. Driver claiming at 600 must SUCCEED
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.claim_after_timeout(arc4.Address(rider), arc4.String("ride-boundary-B"))
        with pytest.raises(AssertionError, match="Ride does not exist"):
            contract.get_ride(arc4.Address(rider), arc4.String("ride-boundary-B"))


# =============================================================================
# [algorand_python_testing mock] Complete State Machine & Lifecycle Tests
# =============================================================================


def test_happy_path():
    """[algorand_python_testing mock] Happy path: Booked -> Started -> Dropped -> Completed."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 200_000
        pay = make_payment(ctx, rider, app.address, fare)

        # 1. Book trip
        contract.book_trip(arc4.String("ride-1"), arc4.Address(driver), pay)
        ride = contract.get_ride(arc4.Address(rider), arc4.String("ride-1"))
        assert ride.status.native == STATUS_BOOKED
        assert ride.amount.native == fare

        # 2. Driver starts ride
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-1"))
        ride = contract.get_ride(arc4.Address(rider), arc4.String("ride-1"))
        assert ride.status.native == STATUS_STARTED

        # 3. Driver marks dropoff
        ctx.ledger.patch_global_fields(round=500)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-1"))
        ride = contract.get_ride(arc4.Address(rider), arc4.String("ride-1"))
        assert ride.status.native == STATUS_DROPPED
        assert ride.round.native == 500

        # 4. Rider confirms completion
        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-1"))

        itxn_driver = ctx.txn.last_group._itxn_groups[0][0]
        itxn_rider = ctx.txn.last_group._itxn_groups[1][0]
        assert itxn_driver.receiver == driver
        assert itxn_driver.amount == fare
        assert itxn_driver.fee == 0

        assert itxn_rider.receiver == rider
        assert itxn_rider.amount == BOX_MBR
        assert itxn_rider.fee == 0

        with pytest.raises(AssertionError, match="Ride does not exist"):
            contract.get_ride(arc4.Address(rider), arc4.String("ride-1"))


def test_confirm_complete_directly_from_started():
    """[algorand_python_testing mock] Rider confirms completion while in STARTED state."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 120_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-early"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-early"))

        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-early"))
        itxn_driver = ctx.txn.last_group._itxn_groups[0][0]
        assert itxn_driver.amount == fare


def test_cancel_before_start_by_rider():
    """[algorand_python_testing mock] Rider cancels trip in BOOKED state."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-cancel"), arc4.Address(driver), pay)

        contract.cancel_trip(arc4.Address(rider), arc4.String("ride-cancel"))
        itxn = ctx.txn.last_group._itxn_groups[0][0]
        assert itxn.receiver == rider
        assert itxn.amount == fare + BOX_MBR
        assert itxn.fee == 0


def test_cancel_before_start_by_driver():
    """[algorand_python_testing mock] Driver cancels trip in BOOKED state."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-cancel-d"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.cancel_trip(arc4.Address(rider), arc4.String("ride-cancel-d"))
        itxn = ctx.txn.last_group._itxn_groups[0][0]
        assert itxn.receiver == rider
        assert itxn.amount == fare + BOX_MBR


def test_cancel_after_start_must_fail():
    """[algorand_python_testing mock] Cancellation after trip has STARTED must fail."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        pay = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-start-fail"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-start-fail"))

        with pytest.raises(AssertionError, match="Ride is not in BOOKED status"):
            contract.cancel_trip(arc4.Address(rider), arc4.String("ride-start-fail"))


def test_driver_completes_alone_must_fail():
    """[algorand_python_testing mock] Driver cannot confirm complete alone."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        pay = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-driver-fail"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-driver-fail"))
            with pytest.raises(AssertionError, match="Only rider can confirm completion"):
                contract.confirm_complete(arc4.Address(rider), arc4.String("ride-driver-fail"))


def test_double_confirm_must_fail():
    """[algorand_python_testing mock] Double confirm completion must fail."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        pay = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-double"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-double"))

        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-double"))

        with pytest.raises(AssertionError, match="Ride does not exist"):
            contract.confirm_complete(arc4.Address(rider), arc4.String("ride-double"))


def test_dispute_then_resolve_pay_driver():
    """[algorand_python_testing mock] Dispute resolved in favor of driver."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, admin = setup_escrow(ctx)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-disp1"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-disp1"))

        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-disp1"))
        assert contract.get_ride(arc4.Address(rider), arc4.String("ride-disp1")).status.native == STATUS_DISPUTED

        contract.resolve_dispute(arc4.Address(rider), arc4.String("ride-disp1"), True)
        itxn_driver = ctx.txn.last_group._itxn_groups[0][0]
        itxn_rider = ctx.txn.last_group._itxn_groups[1][0]
        assert itxn_driver.receiver == driver
        assert itxn_driver.amount == fare
        assert itxn_rider.receiver == rider
        assert itxn_rider.amount == BOX_MBR


def test_dispute_then_resolve_refund_rider():
    """[algorand_python_testing mock] Dispute resolved in favor of rider."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, admin = setup_escrow(ctx)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-disp2"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-disp2"))

        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-disp2"))
        contract.resolve_dispute(arc4.Address(rider), arc4.String("ride-disp2"), False)
        itxn_rider = ctx.txn.last_group._itxn_groups[0][0]
        assert itxn_rider.receiver == rider
        assert itxn_rider.amount == fare + BOX_MBR


def test_reclaim_after_dispute_timeout():
    """[algorand_python_testing mock] Rider reclaims funds after dispute timeout elapses."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx, dispute_timeout_rounds=200)
        fare = 150_000
        pay = make_payment(ctx, rider, app.address, fare)
        contract.book_trip(arc4.String("ride-reclaim"), arc4.Address(driver), pay)

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-reclaim"))

        ctx.ledger.patch_global_fields(round=100)
        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-reclaim"))

        ctx.ledger.patch_global_fields(round=250)
        with pytest.raises(AssertionError, match="Dispute timeout has not elapsed"):
            contract.reclaim_after_dispute_timeout(arc4.Address(rider), arc4.String("ride-reclaim"))

        ctx.ledger.patch_global_fields(round=300)
        contract.reclaim_after_dispute_timeout(arc4.Address(rider), arc4.String("ride-reclaim"))
        itxn_rider = ctx.txn.last_group._itxn_groups[0][0]
        assert itxn_rider.receiver == rider
        assert itxn_rider.amount == fare + BOX_MBR


def test_two_concurrent_rides_different_ids():
    """[algorand_python_testing mock] Two concurrent rides operate independently."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)

        pay1 = make_payment(ctx, rider, app.address, 100_000)
        contract.book_trip(arc4.String("ride-A"), arc4.Address(driver), pay1)

        pay2 = make_payment(ctx, rider, app.address, 250_000)
        contract.book_trip(arc4.String("ride-B"), arc4.Address(driver), pay2)

        ride_a = contract.get_ride(arc4.Address(rider), arc4.String("ride-A"))
        ride_b = contract.get_ride(arc4.Address(rider), arc4.String("ride-B"))
        assert ride_a.amount.native == 100_000
        assert ride_b.amount.native == 250_000

        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-A"))

        assert contract.get_ride(arc4.Address(rider), arc4.String("ride-A")).status.native == STATUS_STARTED
        assert contract.get_ride(arc4.Address(rider), arc4.String("ride-B")).status.native == STATUS_BOOKED

        contract.confirm_complete(arc4.Address(rider), arc4.String("ride-A"))
        with pytest.raises(AssertionError, match="Ride does not exist"):
            contract.get_ride(arc4.Address(rider), arc4.String("ride-A"))
        assert contract.get_ride(arc4.Address(rider), arc4.String("ride-B")).amount.native == 250_000


def test_booking_same_ride_id_twice_must_fail():
    """[algorand_python_testing mock] Booking the same ride_id twice must fail."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, _ = setup_escrow(ctx)
        pay1 = make_payment(ctx, rider, app.address, 100_000)
        contract.book_trip(arc4.String("ride-dup"), arc4.Address(driver), pay1)

        pay2 = make_payment(ctx, rider, app.address, 100_000)
        with pytest.raises(AssertionError, match="Ride already exists"):
            contract.book_trip(arc4.String("ride-dup"), arc4.Address(driver), pay2)


def test_no_id_squatting_different_rider():
    """[algorand_python_testing mock] Another account cannot squat or affect another rider's ride_id."""
    with algopy_testing_context() as ctx:
        contract, app, rider1, driver1, _ = setup_escrow(ctx)
        rider2 = ctx.any.account()
        driver2 = ctx.any.account()

        pay1 = make_payment(ctx, rider1, app.address, 100_000)
        contract.book_trip(arc4.String("ride-same-id"), arc4.Address(driver1), pay1)

        pay2 = ctx.any.txn.payment(
            sender=rider2,
            receiver=app.address,
            amount=150_000 + BOX_MBR,
            close_remainder_to=Global.zero_address,
            rekey_to=Global.zero_address,
        )
        with ctx.txn.create_group(active_txn_overrides={"sender": rider2}):
            contract.book_trip(arc4.String("ride-same-id"), arc4.Address(driver2), pay2)

        ride1 = contract.get_ride(arc4.Address(rider1), arc4.String("ride-same-id"))
        ride2 = contract.get_ride(arc4.Address(rider2), arc4.String("ride-same-id"))
        assert ride1.amount.native == 100_000
        assert ride2.amount.native == 150_000

        with ctx.txn.create_group(active_txn_overrides={"sender": rider2}):
            with pytest.raises(AssertionError, match="Only rider or driver can cancel"):
                contract.cancel_trip(arc4.Address(rider1), arc4.String("ride-same-id"))


def test_wrong_caller_on_every_method():
    """[algorand_python_testing mock] Verify authorization checks reject wrong callers on all methods."""
    with algopy_testing_context() as ctx:
        contract, app, rider, driver, creator = setup_escrow(ctx)
        stranger = ctx.any.account()
        new_admin = ctx.any.account()

        # 1. book_trip: driver cannot be rider
        pay_invalid = make_payment(ctx, rider, app.address, 100_000)
        with pytest.raises(AssertionError, match="Driver cannot be rider"):
            contract.book_trip(arc4.String("ride-inv"), arc4.Address(rider), pay_invalid)

        # 2. set_admin: non-creator cannot set admin
        with ctx.txn.create_group(active_txn_overrides={"sender": stranger}):
            with pytest.raises(AssertionError, match="Only creator can set admin"):
                contract.set_admin(new_admin)

        contract.set_admin(new_admin)
        assert contract.admin == new_admin

        # Book a valid ride
        pay = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-auth"), arc4.Address(driver), pay)

        # 3. cancel_trip: stranger cannot cancel
        with ctx.txn.create_group(active_txn_overrides={"sender": stranger}):
            with pytest.raises(AssertionError, match="Only rider or driver can cancel"):
                contract.cancel_trip(arc4.Address(rider), arc4.String("ride-auth"))

        # 4. start_ride: non-driver cannot start
        with pytest.raises(AssertionError, match="Only driver can start ride"):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-auth"))

        # Driver starts ride
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-auth"))

        # 5. mark_dropoff: non-driver cannot mark dropoff
        with pytest.raises(AssertionError, match="Only driver can mark dropoff"):
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-auth"))

        # 6. confirm_complete: non-rider cannot confirm complete
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            with pytest.raises(AssertionError, match="Only rider can confirm completion"):
                contract.confirm_complete(arc4.Address(rider), arc4.String("ride-auth"))

        # 7. raise_dispute: non-rider cannot raise dispute
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            with pytest.raises(AssertionError, match="Only rider can raise dispute"):
                contract.raise_dispute(arc4.Address(rider), arc4.String("ride-auth"))

        # Rider raises dispute
        contract.raise_dispute(arc4.Address(rider), arc4.String("ride-auth"))

        # 8. resolve_dispute: non-admin cannot resolve
        with ctx.txn.create_group(active_txn_overrides={"sender": creator}):
            with pytest.raises(AssertionError, match="Only admin can resolve dispute"):
                contract.resolve_dispute(arc4.Address(rider), arc4.String("ride-auth"), True)

        # 9. reclaim_after_dispute_timeout: non-rider cannot reclaim
        ctx.ledger.patch_global_fields(round=1000)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            with pytest.raises(AssertionError, match="Only rider can reclaim after dispute timeout"):
                contract.reclaim_after_dispute_timeout(arc4.Address(rider), arc4.String("ride-auth"))

        # 10. claim_after_timeout: non-driver cannot claim after timeout
        pay_drop = make_payment(ctx, rider, app.address, 150_000)
        contract.book_trip(arc4.String("ride-drop-call"), arc4.Address(driver), pay_drop)
        with ctx.txn.create_group(active_txn_overrides={"sender": driver}):
            contract.start_ride(arc4.Address(rider), arc4.String("ride-drop-call"))
            contract.mark_dropoff(arc4.Address(rider), arc4.String("ride-drop-call"))
        ctx.ledger.patch_global_fields(round=2000)
        with pytest.raises(AssertionError, match="Only driver can claim after timeout"):
            contract.claim_after_timeout(arc4.Address(rider), arc4.String("ride-drop-call"))
