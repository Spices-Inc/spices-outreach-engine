import streamlit as st
import os
from openai import OpenAI

# Initialize OpenAI Client using your key from Upsun Settings
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# --- TRANSIT TIME MAP ---
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
    "ICP 3: BBQ Sauce Manufacturers"
])

st.title(f"🔍 {icp_choice} Lead Generator")

transit_tier = st.radio("Select Shipping Window:", list(SHIPPING_ZONES.keys()))
sub_regions = SHIPPING_ZONES[transit_tier]
selected_region = st.selectbox("Select Specific Region:", list(sub_regions.keys()))
zips = sub_regions[selected_region]

if st.button(f"Generate Leads for {selected_region}"):
    if not os.getenv("OPENAI_API_KEY"):
        st.error("❌ No API Key found in Upsun Settings!")
    else:
        with st.spinner("Agent is scouring the web and filtering leads..."):
            # THE BRAIN CALL: This uses OpenAI to "simulate" a search scan based on your ICP
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": f"You are a B2B Lead Gen Agent for a spice company. Target: {icp_choice}. Area: {zips}."},
                    {"role": "user", "content": f"Identify 3 real or highly probable {icp_choice} in these ZIPs: {zips}. Exclude nationwide brands. Return as a table with: Company Name, City, and 'Why they fit' (mentioning production/kitchen signals)."}
                ]
            )
            
            st.success("✅ Leads Found!")
            st.write(response.choices[0].message.content)
            st.balloons()
