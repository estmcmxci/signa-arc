---
title: "Signed credential envelope"
description: "The versioned envelope signa inspects offline: its fields, their ABI widths and encodings, and what inspection does and does not establish."
---

# Signed credential envelope

An envelope carries one exposure or hedge credential exactly as its issuer signed it, with the EIP-712 domain, the signature, and the issuer and digest it claims. `signa credentials inspect <file>` checks one offline.

Monetary and time fields are decimal strings, never JSON numbers, so no value passes through a floating-point type. Bytes fields are 0x-prefixed hex of exactly their ABI width.

## The envelope

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` | The envelope format version. |
| `kind` | `"exposure" or "hedge"` | Which credential the envelope carries. |
| `domain` | `object` | The EIP-712 domain it was signed under: `name` FXCoverageCredentials, `version` 1, `chainId`, and `verifyingContract`, the credential registry. |
| `credential` | `object` | The credential's fields, listed below for each kind. |
| `signature` | `65-byte hex` | The issuer's EIP-712 signature over the credential. |
| `issuer` | `address` | The issuer the envelope claims. Compared with the recovered signer, never trusted. |
| `digest` | `bytes32 hex` | The EIP-712 digest the envelope claims. Recomputed, never trusted. |

## `credential`, when `kind` is `exposure`

| Field | Type | Description |
|---|---|---|
| `facilityId` | `bytes32` | The facility the exposure belongs to. |
| `exposureCurrency` | `bytes3` | The exposure's currency as three ASCII bytes: EUR is 0x455552. |
| `settlementCurrency` | `bytes3` | The settlement currency as three ASCII bytes: USD is 0x555344. |
| `outstandingValue` | `uint128` | Outstanding value in six-decimal settlement units, as a decimal string. |
| `exposureMaturity` | `uint64` | When the exposure matures, in Unix seconds. |
| `observedAt` | `uint64` | When the issuer observed the facts, in Unix seconds. |
| `validUntil` | `uint64` | When the assertion expires, in Unix seconds. |
| `sequence` | `uint64` | Scoped to the facility. The registry accepts only a sequence above its current one. |
| `sourceCommitment` | `bytes32` | A commitment to the private source record. |

## `credential`, when `kind` is `hedge`

| Field | Type | Description |
|---|---|---|
| `facilityId` | `bytes32` | The facility the hedge covers. |
| `tradeIdCommitment` | `bytes32` | A commitment to the trade identifier. |
| `baseCurrency` | `bytes3` | The currency the hedge delivers, the settlement currency: USD is 0x555344. |
| `quoteCurrency` | `bytes3` | The currency hedged, the exposure currency: EUR is 0x455552. |
| `remainingNotional` | `uint128` | Remaining notional in six-decimal units, as a decimal string. `0` is valid, for a terminal update. |
| `maturity` | `uint64` | When the hedge matures, in Unix seconds. |
| `status` | `hedgeStatus` | ACTIVE, CANCELLED, SETTLED or DISPUTED. |
| `observedAt` | `uint64` | When the issuer observed the facts, in Unix seconds. |
| `validUntil` | `uint64` | When the assertion expires, in Unix seconds. |
| `sequence` | `uint64` | Scoped to the facility and trade commitment. The registry accepts only a sequence above its current one. |
| `sourceCommitment` | `bytes32` | A commitment to the private source record. |

## What inspection establishes

- The envelope is well-formed, with exact ABI widths and decimal strings.
- Its domain names the selected chain and credential registry.
- Its credential names the selected facility.
- Its digest is the credential's EIP-712 hash, recomputed rather than trusted.
- Its signature recovers to the claimed issuer.

## What it does not

- That the registry currently authorizes the signer.
- That the credential has not been revoked.
- That its sequence is above the registry's current one.
- That it would count toward coverage: `signa coverage show` reports the engine's verdict.

A signature authenticates who asserted something. It does not prove that a hedge legally exists.
