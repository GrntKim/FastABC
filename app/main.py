from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
# from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.core.templates import APP_DIR
from app.core.errors import LoginRequired

from app.accounts.router import router as accounts_router
from app.courses.router import router as courses_router
from app.problems.router import router as problems_router
from app.submissions.router import router as submissions_router
from app.grading.router import router as grading_router
from app.review.router import router as review_router

import app.models

# from app.routers import (
#     assignments,
#     courses,
#     drafts,
#     exams,
#     finalizations,
#     grading,
#     reports,
#     review,
#     submissions,
#     terms,
# )

app = FastAPI()
# app.add_middleware(
#     CORSMiddleware,
#     # comma-separated; the Next.js dev server by default
#     allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
#     allow_credentials=True,  # the session cookie
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")

@app.exception_handler(LoginRequired)
def to_login(request: Request, exc: LoginRequired):
    return RedirectResponse("/login", status_code=303)

app.include_router(accounts_router)
app.include_router(courses_router)
app.include_router(problems_router)
app.include_router(submissions_router)
app.include_router(grading_router)
app.include_router(review_router)

# app.include_router(courses.router)
# app.include_router(exams.router)
# app.include_router(assignments.router)
# app.include_router(drafts.router)
# app.include_router(submissions.router)
# app.include_router(grading.router)
# app.include_router(review.router)
# app.include_router(finalizations.router)
# app.include_router(reports.router)
# app.include_router(terms.router)