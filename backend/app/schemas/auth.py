import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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
    display_name: str = Field(min_length=1, max_length=100, alias="displayName")
    password: str = Field(min_length=12, max_length=256)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, alias="currentPassword")
    new_password: str = Field(min_length=12, max_length=256, alias="newPassword")
