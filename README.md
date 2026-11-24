# n8n-nodes-apifirme

Romanian company data from [apifirme.dev](https://apifirme.dev) in [n8n](https://n8n.io):
the official registers (ANAF, ONRC, the Ministry of Finance, BNR) as workflow steps.

## What it has

**apifirme** (an action node)

| Resource | Operations |
|---|---|
| Company | Get (by CUI), Find (by name or trade register number), Check Before Invoicing, Get Changes, Get Financial Statements, Get Many (up to 100 CUIs in one request) |
| Watch List | Get Many, Add, Remove |
| New Company | Count (every plan), Get Many (the plans that include the list) |
| Exchange Rate | Get (BNR's reference rates, the latest or a day's) |

**apifirme Trigger** (polling)

- **Watched Company Changed**: starts the workflow for each change at a company on your
  watch list (VAT registration and its end, fiscal inactivity, strike-off, name, address,
  CAEN code, e-Factura). The first run brings what changed since each company was put on
  the list. Each change costs a request of the month's.
- **New Company Registered**: starts the workflow for each newly registered company that
  matches the filters (counties, the beginning of the activity code, companies or sole
  traders). Switched on, it starts with the companies indexed from then on.

## Installation

In n8n: **Settings > Community Nodes > Install**, and enter `n8n-nodes-apifirme`. On a
self-hosted n8n that has community nodes switched off, see
[n8n's documentation](https://docs.n8n.io/integrations/community-nodes/installation-and-management).

## Credentials

An API key from your account at [apifirme.dev](https://apifirme.dev/cont) (it starts with
`af_live_`). The free plan answers 100 requests a month. Testing the credential costs one
request.

## Care for the data

- A CUI is checked in the node (its digits and its check digit) before anything is asked:
  a mistyped one costs no request.
- A thirteen-digit number is a personal identity number (CNP), not a CUI. The node
  refuses it and sends it nowhere.
- A company the API is still fetching (`202`) is asked again as the API says, up to
  three times.
- A refusal is shown in the API's own words, with the address of the plans where the
  month's requests are used up.

## Development

Built with n8n's own tooling (`@n8n/node-cli`), on Node 22 or later:

```sh
npm install
npm run lint     # n8n's linter for community nodes
npm run build
npm test         # the node's own logic, against the build
npm run dev      # n8n with the node, rebuilt on changes
dev/try.sh       # a workflow with the node in n8n (Docker), against dev/stub.js
```

The API is described at [apifirme.dev/en/docs](https://apifirme.dev/en/docs), as
OpenAPI 3.1 at `https://api.apifirme.dev/openapi.json`. Questions and problems:
dev@apifirme.dev.

## Licence

MIT
