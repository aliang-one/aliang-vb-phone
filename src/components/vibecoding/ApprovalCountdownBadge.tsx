import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '../shared/StatusChip';
import { useNowTick } from '../../hooks/useNowTick';
import { approvalCountdown } from '../../utils/approvalCountdown';

/**
 * 审批作答 SLA 倒计时徽标（跨端统一 P4-2）。expiresAt 缺省或已过即不渲染
 * （返回 null），调用方无需预判。刷新走 useNowTick 的 30s 共享节拍
 * （useEffect interval + 卸载清理），N 个徽标共享一条 interval。
 *
 * 文案固定走 vibecoding 命名空间（ApprovalCenterScreen 的 operations 命名
 * 空间不重复配键，跨 ns 引用与 store 内 i18n.t('vibecoding:...') 同法）。
 */
export const ApprovalCountdownBadge: React.FC<{ expiresAt?: number }> = ({
  expiresAt,
}) => {
  const { t } = useTranslation('vibecoding');
  const now = useNowTick();
  const countdown = approvalCountdown(expiresAt, now);
  if (!countdown) return null;
  const label =
    countdown.tier === 'expiring'
      ? t('session.approval.countdownExpiring')
      : countdown.tier === 'hours'
        ? t('session.approval.countdownHours', { hours: countdown.hours })
        : t('session.approval.countdownMinutes', {
            minutes: countdown.minutes,
          });
  return (
    <StatusChip
      label={label}
      type={countdown.tier === 'expiring' ? 'error' : 'warning'}
    />
  );
};
