from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Self


class SignupIn(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=200)

    @model_validator(mode="after")
    def normalize(self) -> Self:
        self.email = self.email.strip().lower()
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("name must not be blank")
        return self