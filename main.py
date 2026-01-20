import streamlit as st

# --- SIDEBAR: THE AGENT SWITCHER ---
st.sidebar.title("🤖 Agent Selection")
agent_type = st.sidebar.selectbox(
    "Which ICP are we running?",
    ["Spices Outreach", "Meal Prep Partnerships"]
)

# --- CONFIGURATION BASED ON SELECTION ---
if agent_type == "Spices Outreach":
    st.title("🌶️ Spices Outreach Engine")
    instruction = "Enter ZIP Code to find local restaurants & specialty grocers:"
    placeholder = "e.g. 01960"
    search_query = "restaurants and specialty grocery stores in "
    
elif agent_type == "Meal Prep Partnerships":
    st.title("🥗 Meal Prep B2B Engine")
    instruction = "Enter ZIP Code to find Gyms, CrossFit Boxes, and Wellness Centers:"
    placeholder = "e.g. 01960"
    search_query = "CrossFit gyms and personal training studios in "

# --- THE SEARCH BOX ---
zip_code = st.text_input(instruction, placeholder=placeholder)

if zip_code:
    st.write(f"### 🔎 Running {agent_type} for {zip_code}...")
    # This is where the AI 'Brain' uses the search_query + zip_code
    st.success(f"Success! I am now searching for: {search_query}{zip_code}")
    st.info("I will return the business name, owner contact, and partnership potential score.")
