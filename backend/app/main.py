import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import assignments, grading, review, submissions

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    # comma-separated; the Next.js dev server by default
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(grading.router)
app.include_router(review.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}
