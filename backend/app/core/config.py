import os

COOKIE = "fastabc_session"
SESSION_DAYS = 14
# off for http://localhost; set COOKIE_SECURE=1 behind https
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "") == "1"

# a public server keeps it shut so strangers cannot spend the API keys; the demo account still logs in
SIGNUP_OPEN = os.environ.get("SIGNUP_OPEN", "1") == "1"