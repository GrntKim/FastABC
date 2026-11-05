from fastapi import FastAPI

from app.routers import assignments

app = FastAPI()
app.include_router(assignments.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}
