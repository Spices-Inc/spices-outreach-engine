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
## Agent 2: The Researcher (The Detective)
**Objective:** Perform deep-profile analysis on qualified leads to identify the "Decision Maker" and their specific "Power Score."

### Antagonistic Hierarchy Logic:
- **Rule 1: Small/Micro-Business Filter**
  - *Logic:* If no complex hierarchy is detected, assume the **Founder** handles all purchasing.
  - *Score:* HIGH (Direct access to the decision-maker).
- **Rule 2: Medium/Regional Growth Filter**
  - *Logic:* Look for specific roles like "Head of Operations." 
  - *Manual Override:* The system has hard-coded overrides for known high-value targets (e.g., Jennifer Smith at 'Be Wellfed').
  - *Score:* HIGH (Operations/Founders are the gold standard for spice procurement).
- **Rule 3: Large Scale/Hands-Off Filter**
  - *Logic:* If the scale is too large (e.g., Pittsburgh Fresh), assume the owner is "hands-off."
  - *Score:* MEDIUM (Target the General Manager instead).
