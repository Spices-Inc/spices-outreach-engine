import streamlit as st
import os
from openai import OpenAI

# Initialize OpenAI Client - It's verified and working!
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# --- SHIPPING TIER MAP ---
SHIPPING_ZONES = {
    "1-2 Days (Immediate Area)": {
        "MA/NH/RI/CT": ["01960", "02108", "02903", "06001", "03101"]
    },
    "3 Days (Expansion)": {
        "NY/NJ/PA": ["10001", "07001", "19102"]
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

st.title(f"🚀 {icp_choice} - Discovery Engine")
st.write("---")

transit_tier = st.radio("Select Shipping Window:", list(SHIPPING_ZONES.keys()))
sub_regions = SHIPPING_ZONES[transit_tier]
selected_region = st.selectbox("Select Specific Region:", list(sub_regions.keys()))

if st.button(f"Generate Leads for {selected_region}"):
    with st.spinner(f"Agent is scouring {selected_region} for {icp_choice}..."):
        try:
            # THE LIVE BRAIN CALL
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": f"You are a B2B Lead Gen Agent for a high-end spice company. Target: {icp_choice}. Context: You only want local/regional players, no national brands."},
                    {"role": "user", "content": f"Identify 3 real {icp_choice} companies in the following regions: {sub_regions[selected_region]}. Provide a table with: Company Name, City, and 'Production Signal' (why they need bulk spices/co-packing)."}
                ]
            )
            
            st.success("✅ Discovery Complete!")
            st.markdown(response.choices[0].message.content)
            st.balloons()
            
        except Exception as e:
            st.error(f"Brain encountered a hiccup: {e}")

st.sidebar.write("---")
st.sidebar.info("Status: Engine Active ✅")
