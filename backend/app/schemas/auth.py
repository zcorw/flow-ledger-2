import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

DisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    display_name: str
    is_admin: bool


class SetupStatusResponse(BaseModel):
    requires_setup: bool


class BootstrapRequest(BaseModel):
    bootstrap_token: str = Field(min_length=1, alias="bootstrapToken")
    email: EmailStr
    display_name: DisplayName = Field(alias="displayName")
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, alias="currentPassword")
    new_password: str = Field(min_length=12, max_length=256, alias="newPassword")


class UpdateProfileRequest(BaseModel):
    display_name: DisplayName = Field(alias="displayName")
