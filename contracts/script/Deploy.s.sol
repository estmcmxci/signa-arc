// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FacilityRegistry } from "../src/FacilityRegistry.sol";
import { CredentialRegistry } from "../src/CredentialRegistry.sol";
import { CoverageEngine } from "../src/CoverageEngine.sol";
import { CovenantVault } from "../src/CovenantVault.sol";

interface VmDeploy {
    function envAddress(string calldata name) external view returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Arc Testnet deployment of the EUR/USD demonstration facility.
/// @dev Uses Foundry's keystore-backed --account flow; no private key is read by this script.
///      The broadcaster must be FACILITY_ADMIN, because createFacility requires it.
///      The script never moves USDC. USDC's transferFrom staticcalls Arc's blocklist precompile
///      at 0x1800000000000000000000000000000000000001, which forge's local simulator does not
///      implement, so a scripted deposit reverts in simulation. The vault is funded afterwards
///      by `cast send`, which the node executes, and every receipt's status is checked.
contract Deploy {
    VmDeploy private constant VM =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 private constant UNIT = 1e6;

    /// @notice Arc's ERC-20 view of native USDC: 6 decimals, the only view the vault accounts in.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    bytes32 public constant FACILITY_ID = keccak256("signa-covenant-arc-eur-usd-demo");
    bytes3 private constant USD = "USD";
    bytes3 private constant EUR = "EUR";

    /// @notice What the funding step deposits. Coverage is a ratio, so the facility's absolute
    ///         size never enters the verdict.
    uint256 public constant FACILITY_DEPOSIT = 5 * UNIT;
    /// @notice PRD.md §7: 10% of the facility must remain in the vault.
    uint128 public constant RESERVE_AMOUNT = uint128(FACILITY_DEPOSIT / 10);

    error WrongChain(uint256 actualChainId);

    event DeploymentReady(
        uint256 indexed chainId,
        bytes32 indexed facilityId,
        address settlementAsset,
        address facilityRegistry,
        address credentialRegistry,
        address coverageEngine,
        address covenantVault
    );

    /// @notice Deploys the four contracts and freezes the PRD.md §7 policy.
    function run()
        external
        returns (
            FacilityRegistry facilities,
            CredentialRegistry credentials,
            CoverageEngine engine,
            CovenantVault vault
        )
    {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }

        address admin = VM.envAddress("FACILITY_ADMIN");
        address operator = VM.envAddress("ORIGINATOR_OPERATOR");
        address exposureIssuer = VM.envAddress("EXPOSURE_ISSUER");
        address hedgeIssuer = VM.envAddress("HEDGE_ISSUER");

        VM.startBroadcast();
        facilities = new FacilityRegistry();
        facilities.createFacility(
            FacilityRegistry.FacilityPolicy({
                facilityId: FACILITY_ID,
                settlementCurrency: USD,
                exposureCurrency: EUR,
                minCoverageBps: 10_000,
                credentialMaxAge: 24 hours,
                maturityTolerance: 7 days,
                defaultHaircutBps: 500,
                reserveAmount: RESERVE_AMOUNT,
                curePeriod: 5 days,
                maxWaiverDuration: 3 days,
                maxActiveHedges: 8,
                settlementAsset: USDC,
                admin: admin,
                operator: operator,
                frozen: false
            })
        );
        facilities.setExposureIssuer(FACILITY_ID, exposureIssuer, true);
        facilities.setHedgeIssuer(FACILITY_ID, hedgeIssuer, true);
        facilities.freezeFacility(FACILITY_ID);

        credentials = new CredentialRegistry(facilities);
        engine = new CoverageEngine(facilities, credentials);
        vault = new CovenantVault(FACILITY_ID, facilities, engine);
        VM.stopBroadcast();

        emit DeploymentReady(
            block.chainid,
            FACILITY_ID,
            USDC,
            address(facilities),
            address(credentials),
            address(engine),
            address(vault)
        );
    }
}
