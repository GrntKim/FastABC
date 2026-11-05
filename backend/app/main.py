from fastapi import FastAPI

from app.routers import assignments, grading, review, submissions

app = FastAPI()
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(grading.router)
app.include_router(review.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}
