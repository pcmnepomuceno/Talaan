"""SQLAlchemy model: Users.

Stub — see the Users table in CLAUDE.md for the column spec.
Inherit from `Base` (app.database) and define __tablename__ + columns.
Remember: store `password_hash`, never a raw password.
"""

from sqlalchemy import Column, Integer, String

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    account_name = Column(String, nullable=False)