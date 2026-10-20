from sqlalchemy import event

from app.database import engine


def test_me_query_count(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    statements = []

    def count(conn, cursor, statement, *args):
        if statement.startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        assert client.get("/api/v1/me").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(statements) == 2, statements
