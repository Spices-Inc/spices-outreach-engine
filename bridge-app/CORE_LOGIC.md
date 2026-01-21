## Agent 1: The Scout (Discovery Logic)
**Objective:** Identify regional meal-prep companies in the target geography while ignoring national corporations and retail outlets.

### Scouting Parameters:
- **Search Query:** "regional meal prep delivery Pennsylvania"
- **Platform:** Google Search via SerpApi.
- **Negative Filters (Agnostic Exclusions):**
  - Ignore any result containing: Blue Apron, HelloFresh, Factor75, Whole Foods, Walmart, EveryPlate, Sunbasket.
  - Exclude results containing "Restaurant" or "Dine-in" to ensure lead is a delivery/subscription service.
- **Output:** Saves to `outputs/agent1_raw.json`.
