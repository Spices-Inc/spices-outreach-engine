## Agent 1: The Scout (Discovery Logic)
**Objective:** Identify regional meal-prep companies in the target geography while ignoring national corporations and retail outlets.

### Scouting Parameters:
- **Search Query:** "regional meal prep delivery Pennsylvania"
- **Platform:** Google Search via SerpApi.
- **Negative Filters (Agnostic Exclusions):**
  - Ignore any result containing: Blue Apron, HelloFresh, Factor75, Whole Foods, Walmart, EveryPlate, Sunbasket.
  - Exclude results containing "Restaurant" or "Dine-in" to ensure lead is a delivery/subscription service.
- **Output:** Saves to `outputs/agent1_raw.json`.
## Agent: Auditor (The Gatekeeper)
**Objective:** Filter out "noise" (media and massive corps) to ensure only viable regional partners move to Deep Research.

### Qualification Gates:
- **Rule 1: The "Listicle" Block** - Reject if the name or URL contains: `best`, `13`, `magazine`, or `/blog/`. 
  - *Goal: Avoid being a "top 10" mention in an article instead of a direct business lead.*
- **Rule 2: The "National Giant" Blacklist**
  - Reject if the URL contains: `hellofresh`, `factor75`, `blueapron`, `hummusfit`, `freshnlean`, `cookunity`.
  - *Goal: Eliminate massive corporations that don't fit our regional outreach model.*
- **Output:** Saves survivors to `outputs/audited_leads.json`.
