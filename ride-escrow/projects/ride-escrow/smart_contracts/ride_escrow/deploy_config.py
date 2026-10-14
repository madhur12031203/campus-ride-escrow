import logging
import algokit_utils

logger = logging.getLogger(__name__)


def deploy() -> None:
    from smart_contracts.artifacts.ride_escrow.ride_escrow_client import (
        RideEscrowFactory,
    )

    algorand = algokit_utils.AlgorandClient.from_environment()
    deployer = algorand.account.from_environment("DEPLOYER")

    factory = algorand.client.get_typed_app_factory(
        RideEscrowFactory,
        default_sender=deployer.address,
    )

    # Disallow contract update and delete:
    # 1. OnUpdate.Fail ensures deployment fails if contract code differs (updates disallowed)
    # 2. update_params=None and delete_params=None explicitly disallow update/delete ABI calls
    # 3. Contract TEAL rejects UpdateApplication and DeleteApplication at the AVM opcode level
    app_client, result = factory.deploy(
        on_update=algokit_utils.OnUpdate.Fail,
        on_schema_break=algokit_utils.OnSchemaBreak.Fail,
        create_args={"timeout_rounds": 100, "dispute_timeout_rounds": 200},
        update_params=None,
        delete_params=None,
    )

    # Fund the app account with 0.2 ALGO (200,000 microAlgos) at setup
    app_info = algorand.account.get_information(app_client.app_address)
    if app_info.amount < 200_000:
        algorand.send.payment(
            algokit_utils.PaymentParams(
                sender=deployer.address,
                receiver=app_client.app_address,
                amount=algokit_utils.AlgoAmount(micro_algo=200_000 - app_info.amount),
            )
        )

    print("\nDEPLOYMENT COMPLETE")
    print("Operation:", result.operation_performed)
    print("App ID:", app_client.app_id)
    print("App Address:", app_client.app_address)
