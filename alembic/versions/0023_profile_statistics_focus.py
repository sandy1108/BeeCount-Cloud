"""增加用户全局统计视角；旧用户默认结余，账单与账本周期不变。"""
from alembic import op
import sqlalchemy as sa

revision = "0023_profile_statistics_focus"
down_revision = "0022_ledger_statistics_mode"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_profiles",
        sa.Column("statistics_focus", sa.String(16), nullable=False, server_default="balance"),
    )


def downgrade():
    op.drop_column("user_profiles", "statistics_focus")
