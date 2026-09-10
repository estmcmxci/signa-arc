// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CoverageEngine } from "./CoverageEngine.sol";

/// @title ICoverageGate
/// @notice Answers one question: is this facility's FX coverage sufficient for this draw, right
///         now (R-F3-10). A host vault calls it before releasing a draw and acts on the verdict.
/// @dev The gate rules for its caller: `msg.sender` is the host. The reserve is measured against
///      the caller's balance of the facility's settlement asset, and a waiver is read from the
///      caller through `ICoverageHost`. Off-chain callers must call from the host's address.
///      `reason` is NONE on a compliant draw; the coverage deficiency when refused on coverage or
///      permitted under a waiver; RESERVE_VIOLATION when the draw would breach reserveAmount.
interface ICoverageGate {
    /// @notice Rule on whether `amount` may leave `facilityId` under current evidence.
    /// @dev MUST re-evaluate from current credential state. A cached or previously
    ///      emitted verdict never authorises capital (R-F3-1).
    /// @return allowed  true only if the facility is COMPLIANT or under an active bounded waiver,
    ///                  and the draw preserves reserveAmount.
    /// @return reason   why. Always populated, including on success (R-F2-6).
    function assess(bytes32 facilityId, uint256 amount)
        external
        view
        returns (bool allowed, CoverageEngine.ResultReason reason);
}

/// @title ICoverageHost
/// @notice What the gate reads back from the host calling it.
/// @dev A waiver permits draws while non-compliant. It is the lender's decision and lives with
///      the host, so the gate has to ask. A host without waivers returns false.
interface ICoverageHost {
    /// @notice Whether an admin waiver currently permits draws despite insufficient coverage.
    function activeWaiver() external view returns (bool);
}
