from fastapi import FastAPI

from app.routers import assignments, submissions

app = FastAPI()
app.include_router(assignments.router)
app.include_router(submissions.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}
