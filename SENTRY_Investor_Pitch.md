# SedentaryRisk — SENTRY

## Investor Pitch: Complete Backing Document

**Tamper-evident logging and automated attack investigation**
MeitY GENESIS EIR — Cohort 2 · Incubated at Amrita TBI

---

> **How to use this document.** Each section maps to one or two slides. Section 20 is the slide-by-slide outline. Section 18 lists the questions investors are likely to ask, with answers.
>
> **Legend:**
>
> - ✅ verified: demonstrated in the working prototype or taken from a cited source.
> - 🔬 research track: comes from the team's published or in-review work and lives outside the SENTRY prototype codebase.
> - ⚠️ to validate: an assumption or illustrative number the team must confirm before calling it final.
>
> If an investor asks about a ⚠️ item, say "we're validating this with pilots." That is an honest and strong answer at this stage.

> 🚨 **Time-sensitive.** The **Black Hat Asia 2027** Call for Briefings reportedly closes on **20 October 2026**. The conference runs 28 Feb – 3 Mar 2027 at Marina Bay Sands, Singapore. Arsenal, Black Hat's open-source tool track, has its own portal and deadline. Confirm both on [blackhat.com/call-for-papers](https://blackhat.com/call-for-papers.html) **this week**.

---

## Table of contents

1. [The one-liner and elevator pitch](#1-the-one-liner-and-elevator-pitch)
2. [The problem](#2-the-problem)
3. [Economic impact](#3-economic-impact)
4. [Our solution](#4-our-solution)
5. [How it works (architecture)](#5-how-it-works-architecture)
6. [Live demo: what investors will see](#6-live-demo-what-investors-will-see)
7. [Why now](#7-why-now)
8. [Market size](#8-market-size)
9. [Competition and differentiation](#9-competition-and-differentiation)
10. [The product: what we sell, how, and to whom](#10-the-product-what-we-sell-how-and-to-whom)
11. [Business model and pricing](#11-business-model-and-pricing)
12. [Revenue projections, unit economics and profitability](#12-revenue-projections-unit-economics-and-profitability)
13. [Go-to-market and marketing](#13-go-to-market-and-marketing)
14. [Traction and prototype status](#14-traction-and-prototype-status)
15. [Fund utilisation](#15-fund-utilisation)
16. [Roadmap](#16-roadmap)
17. [Team, jobs and social impact](#17-team-jobs-and-social-impact)
18. [Investor Q&A prep](#18-investor-qa-prep)
19. [Risks and mitigations](#19-risks-and-mitigations)
20. [Slide-by-slide deck outline](#20-slide-by-slide-deck-outline)
21. [Open items before the pitch](#21-open-items-before-the-pitch)
22. [Sources](#22-sources)

---

## 1. The one-liner and elevator pitch

**One-liner:**

> SENTRY makes security logs **impossible to secretly edit or delete**, so after a breach you can always prove what happened.

**30-second elevator pitch:**

> When attackers break into a company, one of their first moves is to erase their tracks by deleting or editing the logs. Today's security tools keep those logs in one place and simply _trust_ that nobody touched them. SENTRY fingerprints every log line, chains the fingerprints together, signs them with a protected key, and anchors them on a blockchain. If anyone changes even one entry, we detect it within seconds and show exactly which entry and how. Insurers, regulators, courts and incident responders get evidence they can actually trust. The prototype is working end to end, the research behind it is peer-reviewed, and we're moving to pilots.

**Tagline options:**

- "Evidence that can't be erased."
- "Trust nothing. Verify everything. Even your logs."
- "Logs that testify."

---

## 2. The problem

### 2.1 In plain words

Every computer and network keeps **logs**: a diary of everything that happened, such as who logged in, what ran, and what changed. When something goes wrong, investigators read that diary to work out what happened.

The problem is that the diary is usually kept **in one place, protected by one lock**. An attacker who gets administrator access, which is the goal of almost every serious breach, can **rewrite or delete the diary** before anyone notices.

**No trustworthy logs means no trustworthy evidence.** Without that evidence:

- investigators can't reconstruct the attack;
- the company can't be sure the attacker is gone;
- regulators can't confirm what data was exposed;
- insurers can't verify the claim;
- courts can't rely on the evidence.

### 2.2 The four core weaknesses of traditional logging

| Weakness                  | What it means                                      | Real consequence                                            |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| **Log tampering**         | An attacker with admin rights edits log entries    | False picture of the incident; malicious activity hidden    |
| **Log deletion**          | Logs are wiped or truncated                        | No trace of the attack; impossible forensics                |
| **Centralised failure**   | One server or SIEM holds all logs                  | A single compromise or outage loses all evidence            |
| **Forensic manipulation** | Insiders or attackers alter records after the fact | Evidence is challengeable in court, and claims are disputed |

### 2.3 This is a known, catalogued attack technique

Deleting and modifying logs is a standard step in real attacks, not a theoretical edge case. **MITRE ATT&CK**, the industry's global catalogue of adversary behaviour, lists it explicitly:

- **T1070: Indicator Removal**, with sub-techniques including _Clear Windows Event Logs_ (T1070.001) and _Clear Linux or Mac System Logs_ (T1070.002).
- **T1562: Impair Defenses**, including _Disable or Modify Cloud Logs_ (T1562.008).

These techniques are attributed to many tracked threat groups and ransomware families. If a product assumes logs are honest, it assumes the attacker skipped a step they are known to take.

### 2.4 Why existing tools don't solve it

| Approach                                                             | Why it falls short                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SIEMs** (Splunk, QRadar, Sentinel, Elastic)                        | Store logs centrally and rely on access control. No cryptographic proof that logs weren't altered or dropped. Priced by data volume, which pushes customers to _drop_ logs to save money.                                        |
| **WORM / immutable storage** (e.g. S3 Object Lock)                   | Protects data _after_ it lands in storage. It does not prove the data was complete and unaltered on the way in, and it sits in the same trust domain (one cloud account, one admin).                                             |
| **Cloud-native integrity** (e.g. AWS CloudTrail log-file validation) | Real cryptographic integrity, but **only for that cloud's own API logs**. It doesn't cover your servers, apps or on-prem systems.                                                                                                |
| **Academic provenance tools** (CamFlow, UNICORN, NoDoze, etc.)       | Strong at reconstructing attacks, but they generally don't scale to production volumes and aren't built to produce court-ready evidence. 🔬 _This gap is mapped in the team's survey of 63 systems (IEEE Access, under review)._ |

**The gap:** nobody offers **(1) cryptographic proof of integrity**, **(2) at production scale**, **(3) across any log source**, **(4) with investigation-ready output**, all in one product.

---

## 3. Economic impact

### 3.1 The cost of breaches

| Metric                                      | Figure                                  | Source                         |
| ------------------------------------------- | --------------------------------------- | ------------------------------ |
| Global average cost of a data breach (2025) | **USD 4.44 million**                    | IBM Cost of a Data Breach 2025 |
| Average breach cost for US companies (2025) | **USD 10.22 million**, an all-time high | IBM 2025                       |
| Mean time to identify and contain a breach  | **241 days**, roughly 8 months          | IBM 2025                       |

**The link to our product:** much of that cost comes from _not knowing what happened_. That means longer investigations, over-broad breach notifications, longer downtime, and disputed insurance claims. Tampered or missing logs directly lengthen the 241-day window and raise the bill.

### 3.2 Where the money is lost when logs can't be trusted

1. **Longer investigations.** Forensic teams bill by the hour and spend days reconstructing what logs should have shown.
2. **Over-notification.** If you can't prove _which_ records were accessed, you must assume _all_ of them were. That means more notifications, more fines and more reputational damage.
3. **Failed insurance claims.** Cyber insurers increasingly require evidence of controls and of the incident timeline.
4. **Regulatory penalties.** Many regulations require logs to be protected from modification (see 3.3).
5. **Lost prosecutions.** Evidence that can't be shown to be intact can be challenged in court.
6. **Repeat breaches.** If you can't see how the attacker got in, you can't be sure you've closed the door.

### 3.3 Regulation is making log integrity mandatory

| Regulation                                 | Requirement relevant to SENTRY                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **CERT-In Directions (India, April 2022)** | Maintain ICT system logs for **180 days within India**; report incidents within **6 hours**                 |
| **DPDP Act 2023 (India)**                  | Data fiduciaries must protect personal data and report breaches. Provable logs support both.                |
| **RBI / SEBI cyber frameworks (India)**    | Audit trails and log monitoring for banks, NBFCs and market intermediaries                                  |
| **PCI DSS v4.0, Requirement 10**           | Audit logs must be **protected from destruction and unauthorised modification**, and retained for 12 months |
| **HIPAA §164.312(b)**                      | Audit controls that record and examine activity on systems holding health data                              |
| **SEC cyber disclosure rules (US, 2023)**  | Disclose material incidents within **4 business days**, which requires fast, reliable evidence              |
| **EU NIS2 and DORA**                       | Strict incident reporting (24-hour early warning under NIS2) and ICT risk evidence for financial entities   |
| **US OMB M-21-31**                         | Federal logging maturity model, including log integrity and retention                                       |

**Pitch line:** _"Regulators are moving from 'keep logs' to 'prove your logs weren't touched'. SENTRY is built for the second requirement."_

### 3.4 India-specific context

- India's cybersecurity **product** industry reached **USD 4.46 billion revenue in 2025**, with 400+ product companies growing at a **34% CAGR over five years** (DSCI). That's a fast-growing domestic market with policy support for home-grown security IP.
- CERT-In's 6-hour reporting window and its 180-day in-country log retention rule create direct demand for logs that are **local, retained and provably intact**.

---

## 4. Our solution

### 4.1 In plain words

SENTRY gives every log line a **fingerprint** (a SHA-256 hash). Each fingerprint includes the previous one, so the fingerprints form a **chain**. Each link is **signed** with a protected key. Batches of fingerprints are **locked onto a blockchain**, Hyperledger Fabric, that no single admin controls.

> **Change even one old log entry and the chain visibly breaks.** SENTRY pinpoints exactly which entry was touched and how it was attacked.

The raw logs stay **private and encrypted**. Only fingerprints go on the blockchain.

### 4.2 The four guarantees

| Guarantee                                                                           | How SENTRY delivers it                                                               | Status                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| **Integrity:** no entry can be silently edited                                      | SHA-256 hash chain plus an Ed25519 signature per entry                               | ✅                              |
| **Completeness:** no entry can be silently deleted, including at the end of the log | Merkle-root batches anchored on Hyperledger Fabric, cross-checked against local data | ✅                              |
| **Confidentiality:** logs stay private                                              | AES-256-GCM encryption at rest; only hashes go on-chain                              | ✅                              |
| **Capture completeness:** proof nothing was dropped _during capture_                | eBPF loss-aware capture with completeness attestation                                | 🔬 research track (ICMLDE 2026) |

Plus **automated attack-path reconstruction** using a provenance graph and a trained GNN (graph neural network). 🔬 _This is a research track built by the team, separate from the SENTRY prototype codebase._

### 4.3 What the customer experiences

1. **Install:** one command (`./sentry`) brings up the agent, the ledger connection and the dashboard.
2. **Forget about it:** logs from journald, syslog, auth and audit sources are captured, sealed and anchored automatically.
3. **Watch:** a live dashboard shows the evidence pipeline, the hash chain, sealed batches and the blockchain network.
4. **Get alerted:** the integrity monitor re-verifies everything every 5 seconds. Any change produces an immediate alert naming the exact entry and the defence layer that caught it.
5. **Prove it:** one click runs full verification against the blockchain and produces evidence suitable for auditors, insurers and courts.

---

## 5. How it works (architecture)

```
  OS / app logs                SENTRY AGENT (on each host)                       BLOCKCHAIN
 ┌────────────┐   ┌──────────────────────────────────────────────────┐   ┌──────────────────────┐
 │ journald   │   │ 1 CAPTURE   follow log sources in real time       │   │ Hyperledger Fabric   │
 │ syslog     │──►│ 2 HASH      hashₙ = SHA-256(hashₙ₋₁ ‖ logₙ)       │   │ multi-org network    │
 │ auth.log   │   │ 3 SIGN      sigₙ  = Ed25519(hashₙ) (software HSM) │   │ (orderer + peers)    │
 │ audit.log  │   │ 4 ENCRYPT   AES-256-GCM → local evidence store    │   │                      │
 │ UDP syslog │   │ 5 BATCH     root = Merkle(sig₁…sigₖ) every 20     │──►│ logstore chaincode:  │
 └────────────┘   │             logs or 5 s                           │   │ create + read only,  │
                  │ 6 ANCHOR    root → Fabric (retried if offline)    │   │ NO update, NO delete │
                  └──────────────────────────────────────────────────┘   └──────────────────────┘
                                         │
                       VERIFIER + LIVE DASHBOARD
                       • recompute chain, check every signature, decrypt and authenticate
                       • recompute every Merkle root and compare with the root on the ledger
                       • alert within seconds; name the exact entry and attack type
```

### 5.1 Five independent layers

An attacker must defeat **all five** layers to hide a change. Each layer catches a different attack:

| Layer                             | Catches                                                 | Demo attack it detects                             |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| SHA-256 hash chain                | Edited, inserted or deleted entries break the chain     | _Delete evidence_: HASH_MISMATCH on the next entry |
| Ed25519 signature (protected key) | An attacker who recomputes hashes still can't sign them | _Insider forgery_: BAD_SIGNATURE                   |
| AES-256-GCM authentication        | Any byte changed in stored ciphertext                   | _Modify a stored log_: CIPHERTEXT_TAMPERED         |
| Merkle batch root                 | Rows removed or swapped inside a sealed batch           | _Delete evidence_: LOCAL_ROOT_MISMATCH             |
| Fabric ledger anchor              | A local root rewritten to cover tracks                  | ONCHAIN_MISMATCH / MISSING_ON_CHAIN                |

### 5.2 Design choices worth telling technical investors

- **Hyperledger Fabric** rather than a public chain: it's permissioned, has no gas fees or cryptocurrency, gives predictable throughput, can be hosted in India for data sovereignty, and is enterprise-ready. Its consortium model suits regulators, auditors and customers sharing one ledger.
- **Only fingerprints go on-chain.** No personal data reaches the ledger, which avoids the conflict between GDPR/DPDP data-erasure rights and immutable storage.
- **Batching:** one blockchain transaction covers many logs, so cost and throughput scale with batches, not with individual log lines.
- **Nothing is silently lost:** if the blockchain is unreachable, roots are stored locally as "pending" and retried automatically.
- **The smart contract cannot update or delete.** Once a root is anchored, nobody can change it, including us.

---

## 6. Live demo: what investors will see

The prototype includes a **real-time command-centre dashboard**. Suggested 3-minute demo script:

| Step | Action                                      | What the audience sees                                                                                                                    |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Run `./sentry`                              | SedentaryRisk banner. Fabric, chaincode, keys and agent come up automatically, and the dashboard opens.                                   |
| 2    | Click **Generate 5 log events**             | Logs animate through capture → hash → sign → encrypt → Merkle → Fabric. New blocks join the live hash chain.                              |
| 3    | Wait about 5 seconds                        | A batch is sealed and anchored on the blockchain with a real transaction ID. The ledger height increases.                                 |
| 4    | Click **Run full verification**             | Every check turns green. Batch roots match the blockchain.                                                                                |
| 5    | Click **Insider forgery** in the Attack Lab | Within milliseconds the screen turns red: TAMPERING DETECTED, the exact log number, BAD_SIGNATURE, and the broken chain link highlighted. |
| 6    | Click **Delete evidence**                   | The hash chain breaks, and the batch root no longer matches the blockchain: LOCAL_ROOT_MISMATCH.                                          |

**Closing line for the demo:** _"An attacker with full database access just tried three different ways to rewrite history. Every attempt was caught, attributed to an exact entry, and proven against a ledger they can't touch."_

> **Demo tips:** run `./sentry reset` before the meeting so the chain starts clean, and test on the presentation laptop the day before. Also have a screen recording ready as a backup in case there's no network.

---

## 7. Why now

1. **Regulation has shifted from "keep logs" to "prove logs":** CERT-In 2022, DPDP 2023, PCI DSS v4.0, SEC 2023, NIS2 and DORA.
2. **Breach costs are high and visible:** USD 4.44M globally and USD 10.22M in the US, with breaches taking 241 days to contain.
3. **SIEM pricing pain:** volume-based pricing pushes companies to drop logs. Customers are looking for alternatives and complements.
4. **Enterprise blockchain has matured:** Hyperledger Fabric is production-proven. The hype cycle is over, and what's left is useful infrastructure.
5. **Cyber insurance is tightening:** insurers want evidence of controls and timelines before paying claims.
6. **India's policy tailwinds:** MeitY's GENESIS programme, "Make in India" cybersecurity, data localisation, and a domestic security-product industry growing 34% a year.
7. **AI-driven attacks are accelerating:** faster, automated intrusions make automated, tamper-proof evidence a requirement.

---

## 8. Market size

### 8.1 Reference markets (sourced)

| Market                       | Size                                     | Growth          | Source                                           |
| ---------------------------- | ---------------------------------------- | --------------- | ------------------------------------------------ |
| SIEM (global)                | USD 10.78 B (2025) → 19.13 B (2030)      | 12.2% CAGR      | Expert Insights (cited in team brief)            |
| Digital forensics (global)   | USD 12.4 B (2025) → 35.3 B (2033)        | 14.3% CAGR      | Grand View Research (cited in team brief)        |
| Log management (global)      | ~USD 3.5–4.5 B (2025), by most estimates | ~10–13% CAGR    | Multiple analyst firms (estimates vary by scope) |
| India cybersecurity products | USD 4.46 B revenue (2025)                | 34% 5-year CAGR | DSCI                                             |

> ⚠️ Use **one** headline number on the slide and keep the others for Q&A. The unverified "$20B by 2030" in the current deck should be replaced with one of the sourced figures above.

### 8.2 TAM / SAM / SOM (⚠️ illustrative, to validate)

| Level             | Definition                                                                                                                                           | Estimate                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **TAM**           | Global spend on log integrity, SIEM-adjacent log security and forensic evidence                                                                      | ~USD 25 B (SIEM + digital forensics, 2025)     |
| **SAM**           | Regulated mid-to-large organisations in India + APAC (BFSI, healthcare, government, critical infrastructure, MSSPs) that need provable log integrity | ⚠️ ~USD 600 M–1 B (team to model)              |
| **SOM (5 years)** | ~350 paying organisations, average ACV ₹16 L                                                                                                         | **~₹56 Cr (≈ USD 6.7 M) ARR** (see Section 12) |

**Bottom-up framing for the slide (easier to defend than top-down):**

> "There are thousands of regulated organisations in India alone (banks, NBFCs, insurers, hospitals, listed companies, government bodies, critical infrastructure) that must keep CERT-In-compliant logs. Capturing **350** of them by year 5 at ₹16 L a year gives **₹56 Cr ARR**."

---

## 9. Competition and differentiation

### 9.1 Competitive landscape (facts)

| Player                                                               | What they offer                                     | Limitation SENTRY addresses                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Splunk** (acquired by Cisco for ~USD 28 B, closed March 2024)      | Market-leading SIEM / log analytics                 | Trust-based storage with no cryptographic proof of integrity; expensive per-GB pricing         |
| **Microsoft Sentinel / Elastic Security / Google SecOps**            | Cloud SIEM                                          | Same trust model; integrity depends on the cloud admin                                         |
| **IBM QRadar** (SaaS business sold to Palo Alto Networks, 2024)      | SIEM                                                | Same trust model; platform in transition                                                       |
| **AWS CloudTrail log-file integrity validation**                     | SHA-256 digests plus signing for CloudTrail logs    | Covers AWS API logs only, not your servers, apps or on-prem estate                             |
| **WORM storage** (S3 Object Lock, Azure immutable blob)              | Write-once storage                                  | Protects data only after storage; no proof of completeness; one trust domain                   |
| **Amazon QLDB** (ledger database)                                    | Verifiable ledger DB                                | **AWS ended support in July 2025.** A standalone ledger database isn't a log-security product. |
| **Guardtime KSI** (Estonia)                                          | Keyless signature infrastructure for data integrity | Enterprise/government-heavy and proprietary. Not a log-pipeline product with forensic output.  |
| **Academic provenance systems** (CamFlow, UNICORN, NoDoze, DEPCOMM…) | Attack provenance reconstruction                    | Research prototypes; scaling limits; not court-ready                                           |

### 9.2 Feature comparison

| Capability                                                    | **SENTRY**                 | Mainstream SIEMs  | WORM / cloud integrity    | Academic tools |
| ------------------------------------------------------------- | -------------------------- | ----------------- | ------------------------- | -------------- |
| Cryptographic proof that no log was edited                    | ✅ hash chain + signatures | ❌ trust-based    | ⚠️ partial / single cloud | ⚠️ rarely      |
| Detects silent **deletion**, including at the end of the log  | ✅ Merkle + ledger         | ❌                | ⚠️                        | ❌             |
| Independent anchor outside the admin's control                | ✅ Fabric consortium       | ❌                | ❌ same trust domain      | ❌             |
| Works on any host and log source (on-prem, cloud, air-gapped) | ✅                         | ✅                | ❌ vendor-specific        | ⚠️             |
| Raw data stays private (only hashes on-chain)                 | ✅                         | n/a               | n/a                       | n/a            |
| Proof nothing was dropped _during capture_                    | 🔬 eBPF attestation        | ❌                | ❌                        | ❌             |
| Automated attack-path reconstruction                          | 🔬 provenance + GNN        | ⚠️ analyst-driven | ❌                        | ⚠️ prototypes  |
| Predictable pricing (per host, not per GB)                    | ✅                         | ❌ per GB         | ⚠️ storage-based          | n/a            |
| Live tamper alerting (seconds)                                | ✅ every 5 s               | ❌                | ❌                        | ❌             |
| Proven at production scale                                    | 🔧 being validated         | ✅                | ✅                        | ❌             |

### 9.3 Positioning: complement first, then replace

**We don't need to replace Splunk to win.** SENTRY sits _beside_ the SIEM as the **integrity layer**: "your SIEM analyses logs, SENTRY proves they're real." This shortens sales cycles (no rip-and-replace) and opens partnerships. Over time, the forensic and provenance features let SENTRY take on more of the investigation workload.

### 9.4 Our moat

1. **Research IP:** peer-reviewed foundations (IEEE Access survey of 63 systems; ICMLDE 2026 eBPF completeness paper) 🔬. They take time and original research to copy.
2. **The combination:** each piece has prior art, but integrity + completeness + privacy + automated forensics together does not.
3. **Community and trust:** an open-source edition, conference presence and published papers. In security, trust is the hardest thing to buy.
4. **Regulatory fit for India:** in-country ledger hosting, alignment with CERT-In, and an on-prem / air-gapped option for government.
5. **Network effect (future):** a shared Fabric consortium of regulators, auditors, insurers and customers gets more valuable as more parties join and endorse.

---

## 10. The product: what we sell, how, and to whom

### 10.1 What we sell (product editions) ⚠️ tiers to validate with pilots

| Edition                                               | For                                                          | Includes                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SENTRY Community** (free, open source)              | Individual professionals, researchers, students, small teams | Agent, hash chain, signing, local verification, self-hosted Fabric, basic dashboard                                                                   |
| **SENTRY Pro** (SaaS)                                 | SMEs and mid-market                                          | Managed blockchain anchoring, multi-host dashboard, alerting, 90-day evidence retention, email support                                                |
| **SENTRY Enterprise** (SaaS or private cloud)         | Large enterprises, BFSI, healthcare                          | SIEM connectors (Splunk, Elastic, Sentinel), compliance report packs (CERT-In, PCI DSS, RBI), SSO/RBAC, hardware HSM/TPM keys, SLA, dedicated support |
| **SENTRY Sovereign** (on-prem / air-gapped appliance) | Government, defence, critical infrastructure                 | Fully on-site Fabric network, hardware root of trust, no data leaves the premises                                                                     |
| **Evidence & Forensics Services**                     | Any customer after an incident; law firms; insurers          | Certified integrity reports, attack-path reconstruction, expert support for legal proceedings                                                         |
| **QuantumGuard** (future)                             | Long-retention, high-assurance customers                     | Post-quantum signatures so evidence stays valid against future quantum attacks                                                                        |

### 10.2 To whom (target segments)

| Segment                                                | Why they buy                                                             | Priority                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------- |
| **Banking, NBFC, FinTech, insurance**                  | RBI/SEBI/IRDAI audit-trail rules, CERT-In, PCI DSS, fraud disputes       | ⭐ Beachhead candidate       |
| **Healthcare & health-tech**                           | DPDP, patient data, breach disclosure                                    | ⭐ Beachhead candidate       |
| **Government & public sector, CERT-In ecosystem**      | Evidence integrity, data sovereignty, prosecutions                       | High value, long sales cycle |
| **MSSPs / SOC providers**                              | Differentiate their service; offer provable logs to many clients at once | ⭐ Channel multiplier        |
| **Cloud & SaaS providers**                             | Prove infrastructure integrity to their customers                        | Growth                       |
| **Critical infrastructure** (energy, telecom, OT)      | Regulatory and national-security pressure                                | Growth                       |
| **Digital forensics firms, law firms, cyber insurers** | Need trustworthy evidence                                                | Services and partnerships    |

**Buyer personas:**

- **CISO / Head of Security:** economic buyer. _"Prove to the board and regulators that our logs can't be erased."_
- **SOC Manager:** daily user. _"Instant alerts when someone touches our logs, without another noisy SIEM."_
- **Compliance / Risk Officer:** influencer. _"Audit-ready proof for CERT-In, PCI DSS and RBI."_
- **Incident Responder / Forensic Investigator:** champion. _"Evidence that holds up."_

### 10.3 How we sell and deliver

| Channel                                       | How it works                                                               | When                     |
| --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| **Community-led (open source)**               | Professionals adopt the free edition and pull it into their companies      | From day 1               |
| **Direct sales**                              | Founder-led pilots, then an inside sales and security-engineer team        | Pilots: next 6–12 months |
| **MSSP / channel partners**                   | MSSPs bundle SENTRY into managed SOC services (wholesale pricing)          | Year 2                   |
| **System integrators and government tenders** | Partner with SIs for public-sector deals (GeM portal)                      | Year 2–3                 |
| **Cloud marketplaces**                        | AWS / Azure marketplace listings for frictionless procurement              | Year 2–3                 |
| **Insurer partnerships**                      | Cyber insurers recommend or discount premiums for SENTRY-protected clients | Year 3                   |

---

## 11. Business model and pricing

### 11.1 Model

**Open-core SaaS plus on-prem licences plus services:**

1. **Recurring subscriptions (main revenue):** priced **per protected host per month**, with volume tiers. Predictable for customers, unlike per-GB SIEM pricing.
2. **Annual licences:** for on-prem / Sovereign deployments, plus a one-time setup fee.
3. **Services:** forensic integrity reports, incident support, implementation and training.
4. **Channel revenue:** MSSPs resell at a wholesale discount.

### 11.2 Illustrative pricing ⚠️ (validate with pilots before locking)

| Edition                   | Price (indicative)                                                        | Notes                                                |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Community                 | Free                                                                      | Open source; lead generation                         |
| Pro                       | **₹1,500 / host / month** (~USD 18)                                       | Minimum 10 hosts                                     |
| Enterprise                | **₹3,000–4,000 / host / month**, or annual contract from **₹15 L / year** | Includes SIEM connectors, compliance packs, HSM, SLA |
| Sovereign (on-prem)       | **₹25–60 L / year** licence plus setup                                    | Government, defence, critical infrastructure         |
| Forensic integrity report | **₹2–5 L per incident**                                                   | Services                                             |
| MSSP                      | 30–40% wholesale discount                                                 | Channel                                              |

**Why per-host pricing is a selling point:** SIEM customers routinely complain about volume-based bills. Independent trackers report SIEM ingest costs from roughly **USD 150 to over 1,000 per GB/day** depending on vendor and tier. SENTRY's price doesn't rise when a customer logs _more_, so customers never have to choose between budget and evidence.

---

## 12. Revenue projections, unit economics and profitability

> ⚠️ **All numbers in this section are an illustrative model built from stated assumptions. They are not commitments.** Present them as "our base-case model" and change the assumptions as pilots produce real data. Keerthana and Neha should own and refine this section.

### 12.1 Key assumptions

| Assumption                             | Value                                             | Reasoning                                                                      |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Average contract value (ACV)           | ₹4 L (Y1 pilots) rising to ₹16 L (Y5)             | A mid-size organisation protecting 40–60 hosts on Pro/Enterprise, plus upsells |
| Gross margin                           | 70% (Y1–2) → 80% (Y5)                             | SaaS infrastructure plus Fabric hosting; improves with scale                   |
| Annual logo churn                      | ~10%                                              | Security/compliance tools are sticky once embedded in audits                   |
| Blended fully loaded cost per employee | ~₹18 L / year                                     | India deep-tech blended salary plus overheads                                  |
| Sales cycle                            | 3–6 months (mid-market), 9–18 months (government) | Typical for enterprise security                                                |

### 12.2 Five-year base case

|                                                  | **Y1** (FY27–28) | **Y2**       | **Y3**       | **Y4**       | **Y5**        |
| ------------------------------------------------ | ---------------- | ------------ | ------------ | ------------ | ------------- |
| Paying customers                                 | 5 (pilots)       | 25           | 80           | 180          | 350           |
| Average ACV                                      | ₹4 L             | ₹8 L         | ₹12 L        | ₹15 L        | ₹16 L         |
| **ARR**                                          | **₹0.2 Cr**      | **₹2 Cr**    | **₹9.6 Cr**  | **₹27 Cr**   | **₹56 Cr**    |
| Gross margin                                     | 70%              | 70%          | 75%          | 78%          | 80%           |
| Gross profit                                     | ₹0.14 Cr         | ₹1.4 Cr      | ₹7.2 Cr      | ₹21 Cr       | ₹44.8 Cr      |
| Team size                                        | 6                | 14           | 30           | 55           | 85            |
| People cost                                      | ₹1.1 Cr          | ₹2.5 Cr      | ₹5.4 Cr      | ₹9.9 Cr      | ₹15.3 Cr      |
| Other opex (GTM, cloud, conferences, compliance) | ₹0.5 Cr          | ₹1.5 Cr      | ₹4 Cr        | ₹8 Cr        | ₹14 Cr        |
| **EBITDA**                                       | **−₹1.5 Cr**     | **−₹2.6 Cr** | **−₹2.2 Cr** | **+₹3.1 Cr** | **+₹15.5 Cr** |

**Reading the table:**

- **Breakeven in year 4.** EBITDA margin reaches about 28% in year 5.
- **Cumulative burn to breakeven is about ₹6.3 Cr.** That sizes the funding need: the grant covers the start, and a **seed round of roughly ₹5–8 Cr** (⚠️ team to decide the ask) carries the company to profitability with a buffer.
- Revenue mix in year 5 (illustrative): about 70% SaaS subscriptions, 20% Sovereign licences, 10% services.

### 12.3 Unit economics (targets)

| Metric                           | Target                  | Notes                                                                         |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| CAC (cost to acquire a customer) | ~₹8–10 L                | Enterprise sales, pilots and travel; the community funnel lowers it over time |
| CAC payback                      | ~12–13 months           | ACV ₹12 L × 78% GM ≈ ₹0.78 L gross profit per month                           |
| LTV (customer lifetime value)    | ~₹90 L+                 | ACV × GM ÷ churn = 12 × 0.78 ÷ 0.10                                           |
| LTV : CAC                        | **> 3×** (modelled ~9×) | > 3× is the standard healthy benchmark                                        |
| Net revenue retention            | > 110%                  | Customers add hosts and upgrade tiers over time                               |

### 12.4 Path to profitability: what drives it

1. **High gross margins:** software plus batched blockchain anchoring keeps infrastructure costs low per customer.
2. **Low-cost acquisition:** open source, conferences and papers bring inbound leads, without heavy advertising.
3. **Land and expand:** start with critical servers, then expand to all hosts, then add the forensic and compliance modules.
4. **MSSP leverage:** one partner brings many end customers.
5. **High-margin Sovereign deals:** government and defence pay for on-prem assurance.
6. **Sticky product:** once logs are anchored and auditors rely on SENTRY reports, switching is painful.

---

## 13. Go-to-market and marketing

### 13.1 Strategy: earn trust before selling

In cybersecurity, **credibility within the security community matters more than advertising.** Practitioners trust tools they've seen at conferences, read about in papers, and tried in open source. Our plan follows the proven playbook used by Metasploit, Elastic, Wazuh and many EDR/SIEM vendors: **community → credibility → commercial.**

### 13.2 Phased plan

**Phase 0: Community and credibility (now → 6 months)**

- **Open-source SENTRY Community** on GitHub with docs, a demo video and a one-command install.
- **Conferences:**
  - **Black Hat Asia 2027, Singapore** (28 Feb – 3 Mar 2027). Submit to **Briefings** (CFP reportedly closes **20 Oct 2026**) and to **Arsenal**, which is built specifically for live open-source tool demos and is a natural fit for SENTRY's dashboard and Attack Lab.
  - **India:** Nullcon (Goa), c0c0n (Kochi), BSides chapters (BSides Kerala already presented), OWASP and null chapters.
  - **Global follow-ons:** DEF CON Demo Labs, Black Hat USA Arsenal, regional BSides.
- **Research publications:** IEEE Access (under review), ICMLDE 2026 (Elsevier Procedia CS), plus preprints on arXiv. In security, peer-reviewed work _is_ marketing.
- **Tech talks and workshops:** university chapters, CERT-In / ISAC community events, "break the chain" CTF challenges built on SENTRY.
- **Content:** blog posts and short videos ("We let an attacker delete our logs. Here's what happened"), plus mappings to MITRE ATT&CK T1070.

**Phase 1: Design partners and pilots (6 → 12 months)**

- Turn community users and conference contacts into **3–5 design-partner pilots** (target: 1 bank/NBFC, 1 hospital, 1 MSSP, 1 government body).
- Pilots are free or discounted in exchange for feedback, case studies and reference rights.
- Get **independent penetration testing / security audit** reports to show prospects.

**Phase 2: Commercial launch (12 → 24 months)**

- Launch Pro and Enterprise. Founder-led sales, then a first sales engineer.
- **MSSP partner programme** and the first SIEM integrations (Splunk / Elastic / Sentinel apps).
- Compliance packs (CERT-In, PCI DSS, RBI) as the main hook for regulated buyers.

**Phase 3: Scale (24 months +)**

- Government tenders (GeM), system-integrator partnerships, and cloud marketplaces.
- Expand to APAC (Singapore, UAE, SE Asia), building on the Black Hat Asia presence.
- Cyber-insurer partnerships and QuantumGuard (post-quantum) launch.

### 13.3 Marketing funnel

```
 AWARENESS      conferences · papers · talks · CTFs · content
     ↓
 ADOPTION       free open-source Community edition (GitHub stars, installs)
     ↓
 ENGAGEMENT     community Slack/Discord, docs, webinars, contributions
     ↓
 CONVERSION     pilot → Pro / Enterprise (managed anchoring, compliance, SIEM connectors)
     ↓
 EXPANSION      more hosts · forensic services · Sovereign · MSSP channel
```

### 13.4 GTM metrics to track and report to investors

GitHub stars and forks, active installs, conference talks accepted, papers published, pilot sign-ups, pilot-to-paid conversion, ARR, net revenue retention.

---

## 14. Traction and prototype status

### 14.1 Built and working today ✅

- **End-to-end prototype:** real-time capture (journald, syslog, auth, audit) → SHA-256 hash chain → Ed25519 signing → AES-256-GCM encrypted storage → Merkle batching → **live anchoring on Hyperledger Fabric**, with confirmed transaction IDs.
- **Verification engine:** recomputes the chain, checks every signature, authenticates every ciphertext, and **cross-checks every batch's Merkle root against the blockchain**.
- **Live tamper detection** demonstrated against three attack types (modify, insider forgery, delete). Each is caught by the intended defence layer within milliseconds.
- **One-command product experience:** `./sentry` bootstraps Docker/Fabric, the chaincode, identities and keys, then launches the agent and the dashboard.
- **Real-time command-centre dashboard:** pipeline animation, live hash chain, integrity monitor, evidence stream, sealed batches, blockchain topology, ingest rate, Attack Lab.
- **Resilience:** if the blockchain is unreachable, batches are queued and retried, and nothing is silently lost.
- **Real bugs found and fixed in testing:** for example a concurrency issue (team-reported: false positives went from 24 to 0 across 40 concurrent events), and log lines split across reads. This shows engineering discipline, not just happy-path demos.

### 14.2 Research track 🔬

- **IEEE Access (under review):** _"System-Level Data Provenance in Digital Forensics"_, a survey of 63 systems with a 7-axis taxonomy and 16-gap matrix.
- **ICMLDE 2026 (Elsevier Procedia CS):** _"Loss-Aware eBPF Provenance Capture with Cryptographically Verifiable Completeness Attestation."_
- **Provenance graph plus trained GNN** for automated attack-path reconstruction.
- **Post-quantum cryptography** groundwork explored (the basis for QuantumGuard).

### 14.3 Honest gaps, and what the funding buys

| Gap                                                                     | Plan                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Signing uses a **software-simulated HSM**                               | Hardware TPM already procured; physical HSM/TPM integration in the next phase |
| Runs on Fabric's **test network**                                       | Production multi-organisation Fabric deployment                               |
| **Production-scale throughput** not yet benchmarked                     | Load testing plus pilots on real workloads                                    |
| eBPF capture and GNN detection live in a **separate research codebase** | Integrate into the SENTRY product                                             |
| No paying customers yet                                                 | Design-partner pilots (Phase 1)                                               |

> Saying this plainly is a strength: _"The core is built and works. This round turns a working prototype into a production product with real customers."_

---

## 15. Fund utilisation

### 15.1 MeitY GENESIS EIR grant: ₹10 Lakh

**Tranche 1 (₹5,00,000): spent and fully accounted for** ✅
Every item is invoice-backed and certified in the CA Utilisation Certificate submitted to MeitY.

| Category                    |        Amount | Details                                                                                                                            |
| --------------------------- | ------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Devices and hardware        |       ~₹3.5 L | Development laptops (Lenovo Legion, MSI Crosshair 16 HX), **TPM module** (for the hardware root of trust), storage and electronics |
| Certifications and skilling |       ~₹1.3 L | CEH v13 (2 team members), AWS Solutions Architect, AWS Cloud Practitioner                                                          |
| Conferences and travel      |        ~₹25 K | BSides Kerala participation and equipment procurement                                                                              |
| **Total**                   | **₹5,00,000** | Fully reconciled against invoices                                                                                                  |

**What Tranche 1 produced:** the full working prototype (core cryptographic pipeline, blockchain anchoring, tamper detection, dashboard), the provenance and GNN research track, two papers, a certified team, and the first conference appearance.

**Tranche 2 (₹5,00,000): planned, requested now**

| Category                           | Planned use                                     |
| ---------------------------------- | ----------------------------------------------- |
| MVP development and infrastructure | Cloud hosting, production Fabric infrastructure |
| Security testing and validation    | Penetration testing, independent security audit |
| Pilot deployment                   | First real customer pilot(s)                    |
| Company registration and IP        | Pvt Ltd incorporation, trademark filing         |
| Expert consultation and mentoring  | Continued technical and business mentoring      |

> **Line to say out loud:** _"Every rupee of Tranche 1 is invoice-backed and CA-certified. This isn't a projection; it's audited."_

### 15.2 Seed round: suggested allocation ⚠️ (team to set the ask)

If raising about **₹5–8 Cr** (enough to reach breakeven in the base case, Section 12):

| Use                     | Share | What it buys                                                                              |
| ----------------------- | ----: | ----------------------------------------------------------------------------------------- |
| Product and engineering |   45% | Hardware HSM, production Fabric, eBPF and GNN integration, SIEM connectors, scale testing |
| Go-to-market            |   25% | Conferences (Black Hat, Nullcon), sales engineers, pilots, marketing content              |
| Security and compliance |   10% | Independent audits, ISO 27001 / SOC 2 readiness, legal                                    |
| Infrastructure          |   10% | Cloud, ledger hosting, demo environments                                                  |
| Operations and buffer   |   10% | Hiring, admin, a 6-month runway buffer                                                    |

**Milestones this round should hit (18–24 months):** production release, 3–5 paying pilots converted, ₹2 Cr ARR, 2+ conference talks, an MSSP partner signed, hardware HSM shipped.

---

## 16. Roadmap

### 16.1 Product roadmap

| Timeline         | Milestone                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Done**         | Working end-to-end prototype, dashboard, one-command install, papers submitted, BSides Kerala                                      |
| **0–3 months**   | Open-source Community release · Black Hat Asia submission · hardware TPM/HSM integration begins · Pvt Ltd incorporation started    |
| **3–6 months**   | Production multi-org Fabric · agent heartbeat (detects a killed agent or capture gaps) · load benchmarks · pen-test and audit      |
| **6–12 months**  | 3–5 design-partner pilots · eBPF capture and GNN detection integrated · SIEM connectors (Splunk/Elastic) · compliance report packs |
| **12–24 months** | Commercial launch (Pro/Enterprise) · MSSP programme · multi-tenant SaaS · SSO/RBAC · Windows agent                                 |
| **24 months +**  | Sovereign appliance · cloud marketplaces · APAC expansion · **QuantumGuard** post-quantum signatures                               |

### 16.2 Company roadmap

1. **Incorporate** as a Private Limited company within 6–7 months.
2. **Ship** the first product and prove it on real workloads.
3. **Feedback and testing** through pilots, experts and mentors.
4. **Improve** based on real usage.
5. **Then post-quantum (PQC):** evolve into **QuantumGuard**, so evidence integrity survives future quantum-capable attackers. This is a product-line extension, not a separate bet.
6. **Grow** the team and customer base and expand into APAC.

---

## 17. Team, jobs and social impact

### 17.1 Founding team

| Name                     | Role                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| **Vasudev B**            | Entrepreneur-in-Residence (EIR), leads the venture; Security Lead |
| **Vighnesh B**           | Lead Blockchain and Backend                                       |
| **Keerthana Sai Gazula** | Blockchain: Smart Contracts and Systems, PQC                      |
| **Neha Manoj**           | Security Analyst, PQC                                             |
| **Ms. Devi Rajeev**      | Faculty Mentor, Assistant Professor                               |

**Team strengths to highlight:** security certifications (CEH v13, AWS), blockchain and backend depth, PQC research, peer-reviewed publications, an incubator (Amrita TBI) and government programme (MeitY GENESIS) backing.

### 17.2 Jobs (direct, from the base-case model)

| Year | Direct jobs | Roles                                                         |
| ---- | ----------: | ------------------------------------------------------------- |
| Y1   |           6 | Security engineers, blockchain/backend developers             |
| Y2   |          14 | + ML engineer (GNN), sales engineer, DevOps                   |
| Y3   |          30 | + customer success, compliance specialists, forensic analysts |
| Y4   |          55 | + regional sales, partner management, research                |
| Y5   |          85 | + international teams, product, support                       |

**Indirect jobs:** MSSP partner staff trained on SENTRY, system-integrator implementation teams, and internships with Amrita and other universities.

**Skilling:** open-source tools, workshops and CTFs train students and professionals in applied cryptography, blockchain and forensics. These skills are in short supply in India.

### 17.3 Social impact

- **Justice and accountability:** tamper-proof logs are what make cybercrime investigations and prosecutions work. Electronic evidence in Indian courts must be shown to be authentic and unaltered (⚠️ verify the exact current provision, now under the Bharatiya Sakshya Adhiniyam, 2023, before citing). SENTRY produces verifiable proof of integrity.
- **Fewer "we don't know what the attacker did" breaches:** faster, accurate breach scoping means fewer people are needlessly notified and citizens' data exposure is properly assessed.
- **Protecting SMEs:** the free Community edition gives small organisations, which can't afford big SIEMs, evidence-grade logging.
- **Data sovereignty and Atmanirbhar cybersecurity:** in-country ledger hosting and home-grown security IP reduce dependence on foreign vendors for national-critical evidence.
- **Trust in digital public infrastructure:** as more government and financial services go digital, provable audit trails strengthen public trust.
- **Insurance and economic resilience:** verifiable evidence speeds up fair insurance payouts and reduces fraud.

---

## 18. Investor Q&A prep

**Q1. Why blockchain? Isn't a signed database enough?**
A signature proves who signed a record. It doesn't stop a privileged attacker deleting the latest records or replacing the whole database, along with the signing key if it's on the same host. Anchoring Merkle roots on a multi-organisation ledger puts the proof **outside the attacker's control**. We use permissioned Fabric: no cryptocurrency, no gas fees, predictable cost, and it can be hosted in India.

**Q2. Doesn't blockchain make this slow and expensive?**
No. We batch: one transaction covers a whole batch of logs (every 20 logs or 5 seconds by default). Blockchain cost scales with batches, not individual log lines. Raw logs never go on-chain.

**Q3. What if the attacker gets root and kills the agent?**
They can stop _future_ capture, but they can't alter what's already sealed and anchored. Our roadmap adds an agent heartbeat anchored on-chain, so a gap in capture is itself detectable. Our eBPF completeness-attestation research 🔬 proves no events were dropped during capture.

**Q4. Where is the private signing key stored?**
Today it's in a software HSM: the key is encrypted at rest with scrypt-derived AES-256-GCM, and only decrypted in memory for the instant it signs. We've procured a hardware TPM, and hardware-backed keys (TPM/HSM) are the next milestone.

**Q5. How is this different from Splunk or Sentinel?**
They analyse logs and trust that the logs are real. We **prove** the logs are real. We complement SIEMs (via connectors) rather than replace them, and our pricing is per host, not per GB.

**Q6. AWS CloudTrail already validates log integrity. Why you?**
CloudTrail validation covers AWS's own API logs only. SENTRY covers any host, any log source, on-prem, cloud or air-gapped, with an independent ledger and forensic output.

**Q7. Who is your first customer?**
⚠️ _Team to finalise the beachhead._ Recommended answer: "Regulated mid-size BFSI and healthcare organisations in India. CERT-In's 180-day log retention and 6-hour reporting rules give them an immediate compliance reason to buy. We're targeting 3–5 design-partner pilots in the next 6–12 months."

**Q8. Do you have revenue or customers?**
"Not yet. We're at the working-prototype stage, grant-funded, and moving to pilots. This round funds the step from prototype to paying customers."

**Q9. What about GDPR/DPDP and the right to erasure on an immutable ledger?**
Only hashes go on-chain, never personal data. The encrypted raw logs stay in the customer's control and can be deleted under retention policies. The on-chain hash reveals nothing.

**Q10. What stops a big vendor from copying you?**
Large SIEM vendors are built around volume-based revenue and central trust. Provable integrity and per-host pricing cut against their model. Our research IP, the combination of features, community trust and India-specific regulatory fit take time to replicate. Being acquired by one of them is also a realistic exit path.

**Q11. What's the exit strategy?**
Strategic acquisition by a SIEM/XDR/security platform (security M&A is very active; for example Cisco–Splunk at about USD 28 B in 2024), a GRC/compliance platform, or a cloud provider. Alternatively, scale to an independent mid-size security company.

**Q12. Why is this team the one to build it?**
We combine security certifications, blockchain engineering, PQC research and published papers, and we've already built a working end-to-end system on grant money, fully audited.

**Q13. How do you make money from open source without giving it all away?**
Open core. The free edition covers single-host local integrity. Revenue comes from what businesses need: managed anchoring, multi-host dashboards, compliance reports, SIEM connectors, hardware keys, SLAs and forensic services.

**Q14. What happens when quantum computers break today's signatures?**
That's the QuantumGuard roadmap: post-quantum signatures, so long-retention evidence stays valid. Our team already has PQC groundwork.

**Q15. How much are you raising and what will it achieve?**
⚠️ _Team to decide._ Framework: "₹X Cr gets us to production release, 3–5 paying pilots, ₹2 Cr ARR and a signed MSSP partner within 18–24 months, and to breakeven by year 4 in our base-case model."

**Q16. What's your biggest risk?**
Long enterprise and government sales cycles. We mitigate with MSSP channels, a free community funnel, and complementing SIEMs rather than replacing them.

---

## 19. Risks and mitigations

| Risk                                         | Mitigation                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Long enterprise / government sales cycles    | MSSP channel, mid-market focus first, open-source funnel, compliance-driven urgency (CERT-In)        |
| "Blockchain" scepticism among buyers         | Lead with the outcome ("provable logs"), not the technology; permissioned Fabric with no crypto      |
| Prototype not yet proven at production scale | Load benchmarks, pilots on real workloads, production Fabric (funded in this round)                  |
| Software HSM is weaker than hardware         | Hardware TPM procured; TPM/HSM integration in the next phase                                         |
| A root attacker stops the agent              | Heartbeat anchoring (roadmap), eBPF completeness attestation 🔬, off-host verification               |
| Big vendors add integrity features           | Speed, research IP, complementary positioning, India-specific sovereignty fit, potential acquisition |
| Regulatory change                            | Flexible compliance packs; regulation trends toward _more_ integrity requirements                    |
| Small founding team                          | Hiring plan funded by the round; mentor and incubator support                                        |

---

## 20. Slide-by-slide deck outline

Recommended: **14 slides**, 10–12 minutes plus a 3-minute demo.

| #   | Slide                  | Key content (from this document)                                                                       |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Title**              | SedentaryRisk · SENTRY: "Evidence that can't be erased." MeitY GENESIS EIR · Amrita TBI                |
| 2   | **Problem**            | Attackers erase their tracks (MITRE T1070). Logs live behind one lock. No evidence means no case. (§2) |
| 3   | **Impact**             | USD 4.44 M average breach; 241 days to contain; regulation now demands _provable_ logs (§3)            |
| 4   | **Solution**           | Fingerprint, chain, sign, anchor. Change one entry and the chain breaks. (§4)                          |
| 5   | **How it works**       | Architecture diagram and the five-layer defence table (§5)                                             |
| 6   | **Live demo**          | Dashboard: generate logs, anchor, attack, detected (§6)                                                |
| 7   | **Why now**            | Regulation, breach costs, SIEM pricing pain, mature enterprise blockchain (§7)                         |
| 8   | **Market**             | One headline market number plus the bottom-up SOM (§8)                                                 |
| 9   | **Competition**        | Feature comparison table; "complement the SIEM, then expand" (§9)                                      |
| 10  | **Business model**     | Editions, per-host pricing, open core plus Sovereign plus services (§10–11)                            |
| 11  | **Traction and GTM**   | Prototype built, papers, BSides; Black Hat Asia, open source, pilots (§13–14)                          |
| 12  | **Financials**         | 5-year base case, breakeven in Y4, unit economics (§12)                                                |
| 13  | **Team and funds**     | Founders, Tranche 1 audited, Tranche 2 / seed allocation, milestones (§15, §17)                        |
| 14  | **The ask and impact** | The ask, the milestones it buys, jobs and social impact, closing line (§15, §17)                       |

**Closing line:**

> _"Every breach investigation starts with one question: can we trust the logs? With SENTRY, the answer is always yes, and we can prove it."_

---

## 21. Open items before the pitch

1. 🚨 **Black Hat Asia 2027:** confirm the Briefings deadline (reportedly **20 Oct 2026**) and the Arsenal deadline, and submit.
2. ⚠️ **Name consistency:** the deck and brief say **"SedentaryRisk"**, while the SENTRY CLI banner says **"SedentryRisk"**. Pick one and use it everywhere: slides, banner, dashboard, domain and trademark filing.
3. ⚠️ **Business-model slide** (deck slide 10) is still a placeholder. Use Sections 11–12 as the structure and have Keerthana and Neha finalise the numbers.
4. ⚠️ **Deck slide 8** still contains "[add Gregory's points]". Replace it with real feedback.
5. ⚠️ **Replace the unverified "$20B by 2030"** with a sourced figure (§8.1).
6. ⚠️ **Set the ask** (amount and instrument) and the milestones it funds (§15.2).
7. ⚠️ **Choose the beachhead segment** (BFSI or healthcare recommended) and name 2–3 target pilot organisations.
8. 🔬 **Research-track demos:** eBPF capture and GNN detection aren't in the SENTRY prototype repo. If you claim them, be ready to show them separately (screenshots, paper figures or a recorded demo).
9. **Demo prep:** run `./sentry reset` before the meeting, rehearse the demo, and keep a backup screen recording.
10. **Verify citations** marked ⚠️ (for example the electronic-evidence provision under the Bharatiya Sakshya Adhiniyam) before putting them on slides.

---

## 22. Sources

- IBM, _Cost of a Data Breach Report 2025_: [ibm.com](https://www.ibm.com/think/x-force/2025-cost-of-a-data-breach-navigating-ai) · coverage: [Help Net Security](https://www.helpnetsecurity.com/2025/08/04/ibm-cost-data-breach-report-2025/), [CyberScoop](https://cyberscoop.com/ibm-cost-data-breach-2025/)
- MITRE ATT&CK T1070 Indicator Removal: [attack.mitre.org](https://attack.mitre.org/versions/v16/techniques/T1070/001/)
- Digital forensics market (Grand View Research): [grandviewresearch.com](https://www.grandviewresearch.com/industry-analysis/digital-forensics-market)
- SIEM market overview (Expert Insights): [expertinsights.com](https://expertinsights.com/security-operations/siem-market-overview-key-stats-and-insights)
- SIEM pricing reference: [siemcostcalculator.com](https://siemcostcalculator.com/splunk-pricing)
- Log management market estimates: [Research and Markets](https://www.researchandmarkets.com/reports/5766756/log-management-market-report), [Precedence Research](https://www.precedenceresearch.com/log-management-market)
- DSCI, _Indian Cybersecurity Product Landscape Report 3.0_: [dsci.in](https://www.dsci.in/resource/content/indian-cybersecurity-product-landscape-report-3.0) · [press release (PDF)](https://www.dsci.in/files/content/press-release/2026/Press-Release_Indian-Cybersecurity-Product-Landscape-3.0-Dec-25.pdf)
- India cybersecurity market (alternative estimates): [IMARC](https://www.imarcgroup.com/india-cybersecurity-market), [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/india-cybersecurity-market)
- Black Hat Asia 2027 CFP: [blackhat.com/call-for-papers](https://blackhat.com/call-for-papers.html) · [event listing](https://10times.com/black-hat-asia)
- Regulatory references: CERT-In Directions (28 April 2022); DPDP Act 2023; PCI DSS v4.0 Req. 10; HIPAA 45 CFR §164.312(b); SEC Release 33-11216 (2023); EU NIS2 Directive 2022/2555; EU DORA Regulation 2022/2554; US OMB M-21-31. Confirm exact clause wording before quoting on slides.

---

_Prepared from the SENTRY prototype codebase and verified test runs, the SedentaryRisk GENESIS EIR pitch brief (`sentry-pitch.md`), and independently sourced market research (cited above). Illustrative financials are a base-case model for the team to validate._
