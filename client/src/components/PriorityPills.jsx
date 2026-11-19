import { useLanguage } from '../i18n';

const PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente', confidentielle: 'Confidentielle' };

export default function PriorityPills({ value, className = '' }) {
  const { t } = useLanguage();
  const prios = Array.isArray(value) ? value : value ? [value] : ['normale'];
  return (
    <div className={'priority-pills ' + className} style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {prios.map((p) => (
        <span key={p} className={'priority-pill priority-' + p} title={t('priorite.' + p)}>
          {t('priorite.' + p)}
        </span>
      ))}
    </div>
  );
}
