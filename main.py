import streamlit as st
import os

# --- TRANSIT TIME MAP (SCF PREFIXES) ---
# This allows you to scale from local to nationwide
SHIPPING_ZONES = {
    "1-2 Days (Immediate Area)": {
        "MA/NH/RI/CT": ["010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "021", "022", "024", "028", "029", "030", "031", "038", "039"]
    },
    "3 Days (Mid-Atlantic/Midwest)": {
        "NY/NJ/PA": ["070", "080", "100", "110", "190"],
        "OH/MI/IN": ["430", "440", "480", "460"]
    },
    "4-6 Days (Nationwide Scale)": {
        "TX/FL/GA": ["750", "331", "303"],
        "CA/OR/WA": ["900", "941", "981"]
    }
}

st.sidebar.title("🤖 Agent Selection")
icp_choice = st.sidebar.selectbox("Select Your Outreach Target:", [
    "ICP 1: Meal Prep Companies",
    "ICP 2: Hot Sauce Manufacturers",
    "ICP 3: BBQ Sauce Manufacturers",
    "ICP 4: BBQ Restaurants",
    "ICP 5: Butchers & Processors"
])

st.title("🌎 Scalable Discovery Engine")
st.write("---")

# --- DYNAMIC ZONE SELECTOR ---
transit_tier = st.radio("Select Shipping Window:", list(SHIPPING_ZONES.keys()))

# Get the sub-regions for the selected tier
sub_regions = SHIPPING_ZONES[transit_tier]
selected_region = st.selectbox("Select Specific Region:", list(sub_regions.keys()))
prefixes = sub_regions[selected_region]

st.info(f"🚀 **Scaling Strategy:** You are currently searching the **{transit_tier}** window. This covers {len(prefixes)} SCF regions.")

# --- THE "RUN DISCOVERY" BUTTON ---
if st.button(f"Scour {selected_region} for {icp_choice}"):
    if not os.getenv("OPENAI_API_KEY"):
        st.error("⚠️ OpenAI Key not found in Upsun Settings!")
    else:
        st.success(f"🧠 Brain Active. Searching {selected_region} for {icp_choice}...")
        # Hour 3 will inject the real search here
        st.write(f"🔍 Digging through SCFs: {', '.join(prefixes)}")
        st.progress(100)
