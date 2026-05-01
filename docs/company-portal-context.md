# FBBS Company and Portal Context

This note summarizes business context from the FBBS approval packet and Salesforce screenshots shared on 2026-05-01. It is intended to help Codex and Claude Code generate better portal ideas without rereading the source packet. Keep it strategic and non-sensitive: do not copy account numbers, settlement instructions, or private contact details into the repo.

## Business Shape

FBBS is a full-service broker dealer focused on fixed income for community financial institutions. The portal should think in terms of institutions, portfolios, holdings, funding needs, market opportunities, sales coverage, and compliance evidence rather than generic CRM objects.

Core product and service areas reflected in the packet:

- Investment portfolio accounting services with real-time portfolio holdings, safekeeping, pledging, portfolio management, and in-house processing for special requests and post-cutoff adjustments.
- Fixed income trading and offerings: municipal bonds, mortgage-backed securities, government and agency bonds, corporate bonds, brokered CDs, money market instruments, structured products, equities, mutual funds, and ETFs.
- Brokered CD and corporate note underwriting, including new issue/secondary bullet CDs, callable CDs, funding strategy support, custom structures, best-efforts and balance-sheet/takedown underwriting.
- Financial Strategies Group: portfolio strategies, transaction scenario reporting, policy development, treasury management, funding, liquidity, investments, and ALM/IRR support.
- Municipal credit analysis and Buyer Comfort Index Score (BCIS): issuer-level monitoring intended to supplement or exceed ongoing municipal credit monitoring requirements.
- ALM/IRR reporting: accounting extract and call report versions, scenario reports, liquidity analysis, duration/convexity, repricing and cash-flow gaps, forward balance sheets, assumption reports, stressed deposit scenarios, deposit/prepayment studies, credit stress tests.

## Salesforce Workflows Observed

The screenshots show Salesforce acting as a thin operating layer for sales coverage rather than as a deeply customized application:

- Strategy task boards: Open, In Progress, Needs Billed, Completed.
- Task rows with subject, date, priority, creator, invoice contact, company/account, and comments.
- Sales dashboard counts for clients, prospects, clients/prospects, open tasks, opportunities, events, calls, and recent records.
- Reports for dynamic clients, dynamic prospects, client/prospect mixes, open account lists, CECIL prospects, and billing/strategy tracking.
- Map view of bank accounts by status: Open, Prospect, Client.
- Recent records and saved reports mostly expose accounts, reps, statuses, addresses, phone numbers, and account ownership.

Portal opportunities should treat these as replaceable workflow surfaces once the portal has durable account records, ownership, status history, tasking, notes, reporting, and exports.

## Portal Product Direction

The strongest direction is to turn the portal into the daily workspace for bank coverage and market intelligence:

- Keep the current daily package, Explorer pages, and Bank Tear Sheets as the foundation.
- Make every bank record the center of work: call report summary, account status, coverage owner, notes, opportunities, tasks, recent documents, portfolio/ALM/BCIS activity, and next action.
- Replace Salesforce reports with native saved views over the bank database: clients, prospects, open accounts, strategy queues, billing queues, stale follow-ups, state/territory views, and product-specific prospects.
- Replace Salesforce dashboards with operational panels: coverage counts, upcoming actions, recently touched banks, new prospects, needs billed, strategy requests, and offering opportunities tied to bank profile.
- Use the existing map concept as a territory and coverage planning view, but avoid demographic targeting; base map filters on bank/account status, rep, state, product fit, and activity.
- Add lightweight workflow first: tasks, notes, statuses, priorities, due dates, billing flags, and completion history. Avoid full CRM complexity until the data model proves itself.

## Replacement Boundaries

Good candidates to absorb into the portal:

- Salesforce strategy/task dashboards.
- Salesforce account lists, saved reports, client/prospect segmentation, recent records, and map views.
- Manual billing queues such as "Needs Billed" for Muni Credit, BCIS, portfolio reports, swaps, ALM/IRR, and other strategy work.
- Internal product workflow tracking for brokered CDs, muni credit/BCIS, ALM/IRR, portfolio reports, and client/prospect follow-up.

Be careful before replacing:

- Custody, clearing, trading, accounting, or external client-access systems.
- Anything that requires permissioning by rep, compliance retention, immutable audit history, or formal approval workflow.
- Email/calendar capture unless the deployment story includes Windows/IIS authentication and a durable integration plan.
- Any feature that turns the trusted-LAN portal into an internet-facing client portal.

## Data Model Signals

Likely entities that should guide future design:

- Bank/account: FDIC cert, legal name, display name, city, state, assets, deposits, regulator, period, account status, coverage owner.
- Contact: person, role, institution, phone/email if available from approved internal source.
- Coverage status: Open, Prospect, Client, Watchlist, Dormant, plus priority, owner, next action, updated_at.
- Task/strategy request: subject, product/service type, status, priority, assigned/created by, due date, account, invoice contact, comments, completed_at.
- Product opportunity: product type, source signal, recommended action, relevant offering/report, estimated value, status.
- Report/job: ALM, BCIS, muni credit, portfolio report, CECIL, swap, billing state, delivery state, related files, audit events.

## Idea Backlog

High-value near-term ideas:

- Native Strategy Queue replacing the Salesforce "Strategies" dashboard with columns for Open, In Progress, Needs Billed, Completed.
- Bank Coverage Home with My Clients, My Prospects, My Open Tasks, Recently Viewed, Recently Updated, and overdue next actions.
- Saved Views and Reports over bank data, exportable to CSV: Dynamic Clients, Dynamic Prospects, CECIL Prospects, Needs Billed, Open Account List.
- Coverage Map using local bank records and account status filters.
- Product Fit flags on tear sheets: CD funding candidate, muni credit/BCIS candidate, ALM/IRR candidate, portfolio accounting candidate, corporate/agency opportunity.
- Billing queue attached to strategy/report work so completed analysis does not disappear before invoice follow-up.
- Account activity timeline combining status changes, notes, uploads, generated reports, task completions, and package interactions.

Architecture ideas to defer until needed:

- App-level auth and per-user permissions.
- Calendar/email sync.
- Full Salesforce import/migration.
- External client portal features.
- Replacing clearing, trading, portfolio accounting, or custody systems.

