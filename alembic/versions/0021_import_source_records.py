"""导入来源追踪，支持跨文件核对，不修改已有交易。"""

from alembic import op
import sqlalchemy as sa

revision = "0021_import_source_records"
down_revision = "0020_category_parent_links"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "import_source_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "ledger_id",
            sa.String(36),
            sa.ForeignKey("ledgers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_format", sa.String(32), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("source_payload", sa.JSON(), nullable=False),
        sa.Column("transaction_sync_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "ledger_id",
            "file_hash",
            "row_number",
            "transaction_sync_id",
            name="uq_import_source_link",
        ),
    )
    op.create_index("ix_import_source_records_ledger_id", "import_source_records", ["ledger_id"])
    op.create_index(
        "ix_import_source_fingerprint", "import_source_records", ["ledger_id", "fingerprint"]
    )


def downgrade():
    op.drop_table("import_source_records")
