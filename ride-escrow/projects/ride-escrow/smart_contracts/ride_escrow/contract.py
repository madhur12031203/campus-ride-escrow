from algopy import (
    ARC4Contract,
    Account,
    BoxMap,
    Bytes,
    Global,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
)

# Constants
MIN_FARE = 100_000
BOX_MBR = 47_700

STATUS_BOOKED = 0
STATUS_STARTED = 1
STATUS_DROPPED = 2
STATUS_DISPUTED = 3


class RideState(arc4.Struct):
    rider: arc4.Address
    driver: arc4.Address
    amount: arc4.UInt64
    status: arc4.UInt8
    round: arc4.UInt64


class RideEscrow(ARC4Contract):
    admin: Account
    timeout_rounds: UInt64
    dispute_timeout_rounds: UInt64

    def __init__(self) -> None:
        self.admin = Account()
        self.timeout_rounds = UInt64(0)
        self.dispute_timeout_rounds = UInt64(0)
        self.rides = BoxMap(Bytes, RideState, key_prefix=b"")

    @arc4.abimethod(create="require")
    def create(self, timeout_rounds: UInt64, dispute_timeout_rounds: UInt64) -> None:
        assert timeout_rounds > UInt64(0), "Timeout rounds must be greater than 0"
        assert dispute_timeout_rounds > UInt64(0), "Dispute timeout rounds must be greater than 0"

        self.admin = Global.creator_address
        self.timeout_rounds = timeout_rounds
        self.dispute_timeout_rounds = dispute_timeout_rounds

    @arc4.abimethod
    def set_admin(self, new_admin: Account) -> None:
        assert Txn.sender == Global.creator_address, "Only creator can set admin"
        assert new_admin != Global.zero_address, "Admin cannot be zero address"
        self.admin = new_admin

    @arc4.abimethod(readonly=True)
    def get_ride(self, rider: arc4.Address, ride_id: arc4.String) -> RideState:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"
        return self.rides[key].copy()

    @arc4.abimethod
    def book_trip(
        self,
        ride_id: arc4.String,
        driver: arc4.Address,
        pay: gtxn.PaymentTransaction,
    ) -> None:
        rider = arc4.Address(Txn.sender)
        key = op.sha256(rider.bytes + ride_id.bytes)

        assert key not in self.rides, "Ride already exists"
        assert (
            pay.group_index + UInt64(1) == Txn.group_index
        ), "Payment transaction must immediately precede application call"
        assert pay.receiver == Global.current_application_address, "Payment receiver must be app address"
        assert pay.sender == Txn.sender, "Payment sender must be transaction sender"
        assert pay.close_remainder_to == Global.zero_address, "Payment close_remainder_to must be zero address"
        assert pay.rekey_to == Global.zero_address, "Payment rekey_to must be zero address"
        assert Txn.rekey_to == Global.zero_address, "Transaction rekey_to must be zero address"
        assert pay.amount >= UInt64(MIN_FARE + BOX_MBR), "Payment amount below minimum fare + MBR"
        assert driver.native != Txn.sender, "Driver cannot be rider"

        fare = pay.amount - UInt64(BOX_MBR)
        fare_arc4 = arc4.UInt64(fare)

        self.rides[key] = RideState(
            rider=rider,
            driver=driver,
            amount=fare_arc4,
            status=arc4.UInt8(STATUS_BOOKED),
            round=arc4.UInt64(0),
        )

        arc4.emit("Booked(string,address,address,uint64)", ride_id, rider, driver, fare_arc4)

    @arc4.abimethod
    def cancel_trip(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert ride.status.native == STATUS_BOOKED, "Ride is not in BOOKED status"
        assert (
            Txn.sender == rider.native or Txn.sender == ride.driver.native
        ), "Only rider or driver can cancel"

        fare = ride.amount.native
        driver = ride.driver
        amount_arc4 = ride.amount
        refund_amount = fare + UInt64(BOX_MBR)

        del self.rides[key]

        itxn.Payment(receiver=rider.native, amount=refund_amount, fee=0).submit()
        arc4.emit("Cancelled(string,address,address,uint64)", ride_id, rider, driver, amount_arc4)

    @arc4.abimethod
    def start_ride(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == ride.driver.native, "Only driver can start ride"
        assert ride.status.native == STATUS_BOOKED, "Ride is not in BOOKED status"

        self.rides[key] = RideState(
            rider=ride.rider,
            driver=ride.driver,
            amount=ride.amount,
            status=arc4.UInt8(STATUS_STARTED),
            round=ride.round,
        )

        arc4.emit("Started(string,address,address,uint64)", ride_id, rider, ride.driver, ride.amount)

    @arc4.abimethod
    def mark_dropoff(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == ride.driver.native, "Only driver can mark dropoff"
        assert ride.status.native == STATUS_STARTED, "Ride is not in STARTED status"

        self.rides[key] = RideState(
            rider=ride.rider,
            driver=ride.driver,
            amount=ride.amount,
            status=arc4.UInt8(STATUS_DROPPED),
            round=arc4.UInt64(Global.round),
        )

        arc4.emit("Dropped(string,address,address,uint64)", ride_id, rider, ride.driver, ride.amount)

    @arc4.abimethod
    def confirm_complete(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == rider.native, "Only rider can confirm completion"
        status = ride.status.native
        assert (
            status == STATUS_STARTED or status == STATUS_DROPPED
        ), "Ride must be STARTED or DROPPED"

        fare = ride.amount.native
        driver = ride.driver
        amount_arc4 = ride.amount

        del self.rides[key]

        itxn.Payment(receiver=driver.native, amount=fare, fee=0).submit()
        itxn.Payment(receiver=rider.native, amount=UInt64(BOX_MBR), fee=0).submit()

        arc4.emit("Completed(string,address,address,uint64)", ride_id, rider, driver, amount_arc4)

    @arc4.abimethod
    def claim_after_timeout(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == ride.driver.native, "Only driver can claim after timeout"
        assert ride.status.native == STATUS_DROPPED, "Ride must be in DROPPED status"
        assert (
            Global.round >= ride.round.native + self.timeout_rounds
        ), "Timeout has not elapsed"

        fare = ride.amount.native
        driver = ride.driver
        amount_arc4 = ride.amount

        del self.rides[key]

        itxn.Payment(receiver=driver.native, amount=fare, fee=0).submit()
        itxn.Payment(receiver=rider.native, amount=UInt64(BOX_MBR), fee=0).submit()

        arc4.emit("Claimed(string,address,address,uint64)", ride_id, rider, driver, amount_arc4)

    @arc4.abimethod
    def raise_dispute(self, rider: arc4.Address, ride_id: arc4.String) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == rider.native, "Only rider can raise dispute"

        status = ride.status.native
        if status == STATUS_STARTED:
            pass
        elif status == STATUS_DROPPED:
            assert (
                Global.round < ride.round.native + self.timeout_rounds
            ), "Timeout has already elapsed"
        else:
            assert False, "Ride cannot be disputed in current status"

        self.rides[key] = RideState(
            rider=ride.rider,
            driver=ride.driver,
            amount=ride.amount,
            status=arc4.UInt8(STATUS_DISPUTED),
            round=arc4.UInt64(Global.round),
        )

        arc4.emit("Disputed(string,address,address,uint64)", ride_id, rider, ride.driver, ride.amount)

    @arc4.abimethod
    def resolve_dispute(
        self,
        rider: arc4.Address,
        ride_id: arc4.String,
        pay_driver: bool,
    ) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == self.admin, "Only admin can resolve dispute"
        assert ride.status.native == STATUS_DISPUTED, "Ride is not in DISPUTED status"

        fare = ride.amount.native
        driver = ride.driver
        amount_arc4 = ride.amount

        del self.rides[key]

        if pay_driver:
            itxn.Payment(receiver=driver.native, amount=fare, fee=0).submit()
            itxn.Payment(receiver=rider.native, amount=UInt64(BOX_MBR), fee=0).submit()
        else:
            refund_amount = fare + UInt64(BOX_MBR)
            itxn.Payment(receiver=rider.native, amount=refund_amount, fee=0).submit()

        arc4.emit("Resolved(string,address,address,uint64)", ride_id, rider, driver, amount_arc4)

    @arc4.abimethod
    def reclaim_after_dispute_timeout(
        self,
        rider: arc4.Address,
        ride_id: arc4.String,
    ) -> None:
        key = op.sha256(rider.bytes + ride_id.bytes)
        assert key in self.rides, "Ride does not exist"

        ride = self.rides[key].copy()
        assert Txn.sender == rider.native, "Only rider can reclaim after dispute timeout"
        assert ride.status.native == STATUS_DISPUTED, "Ride is not in DISPUTED status"
        assert (
            Global.round >= ride.round.native + self.dispute_timeout_rounds
        ), "Dispute timeout has not elapsed"

        fare = ride.amount.native
        driver = ride.driver
        amount_arc4 = ride.amount
        refund_amount = fare + UInt64(BOX_MBR)

        del self.rides[key]

        itxn.Payment(receiver=rider.native, amount=refund_amount, fee=0).submit()
        arc4.emit("Cancelled(string,address,address,uint64)", ride_id, rider, driver, amount_arc4)
