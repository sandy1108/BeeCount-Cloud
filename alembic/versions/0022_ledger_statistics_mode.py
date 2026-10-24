"""账本统计模式；已有账本默认普通模式，不修改交易。"""

from alembic import op
import sqlalchemy as sa

revision = "0022_ledger_statistics_mode"
down_revision = "0021_import_source_records"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ledgers",
        sa.Column("statistics_mode", sa.String(24), nullable=False, server_default="standard"),
    )


def downgrade():
    op.drop_column("ledgers", "statistics_mode")
