"""独立回款关联；不修改原交易和旧客户端同步协议。"""
from alembic import op
import sqlalchemy as sa

revision = '0024_transaction_repayments'
down_revision = '0023_profile_statistics_focus'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('transaction_repayments',
        sa.Column('ledger_id', sa.String(36), sa.ForeignKey('ledgers.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('income_id', sa.String(128), primary_key=True),
        sa.Column('expense_id', sa.String(128), nullable=False),
        sa.Column('tz_offset_minutes', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(500), nullable=False),
        sa.Column('created_by_user_id', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_transaction_repayments_expense_id', 'transaction_repayments', ['expense_id'])


def downgrade():
    op.drop_table('transaction_repayments')
