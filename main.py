import os
import streamlit as st
import requests
import google.generativeai as genai

# 1. API CONFIGURATION
APOLLO_KEY = os.environ.get('APOLLO_API_KEY')
HUNTER_KEY = os.environ.get('HUNTER_API_KEY')
GEMINI_KEY = os.environ.get('GEMINI_API_KEY')

# 2. LOGISTICS ZONES (Your SCF Data)
ZONE_1_DAY = ['112', '180', '160', '123', '227', '118', '195', '052', '178', '170', '211', '217', '121', '088', '172', '177', '100', '103', '109', '114', '150', '188', '142', '139', '105', '128', '174', '184', '113', '201', '144']
ZONE_2_DAY = ['480', '445', '450', '551', '040', '606', '217', '432', '371', '365', '038', '625', '497', '481', '502', '537', '495', '281', '342', '193', '232', '601', '612', '287', '618', '303', '602', '029', '366', '065']

def get_shipping_speed(zip_code):
    prefix = str(zip_code)[:3]
    if prefix in ZONE_1_DAY:
        return "Next-Day Delivery"
    elif prefix in ZONE_2_DAY:
        return "Fast 2-Day Shipping"
    return "Reliable Nationwide Shipping"

# Streamlit UI
st.set_page_config(page_title="Spices Outreach Engine", page_icon="🌶️")
st.title("🌶️ Spices Outreach Engine")

st.header("Shipping Speed Lookup")
zip_code = st.text_input("Enter ZIP Code", value="11232")

if st.button("Check Shipping Speed"):
    if zip_code:
        speed = get_shipping_speed(zip_code)
        st.success(f"**{zip_code}**: {speed}")
    else:
        st.warning("Please enter a ZIP code")

st.divider()
st.caption("Spices Inc - Outreach Engine")
