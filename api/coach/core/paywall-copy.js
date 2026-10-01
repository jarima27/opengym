// The paywall's built-in words, before an admin edits any (api/paywall.js, Admin → Paywall).
// Runtime-neutral, so the app reads the same ones where there is no server to ask: the demo
// shows the real offer in these words (frontend/src/lib/paywall.js demoPaywall).
export const DEFAULT_COPY = {
  es: {
    title: 'Un entrenador que revisa tu semana',
    titleStall: 'Deja de estancarte en {exercise}',
    titleComeback: '¿Unos días fuera? El Coach puede reajustar tu semana.',
    titleDay7: 'Tu plan ha funcionado esta semana. ¿Quieres que el Coach lo ajuste cada lunes?',
    subtitle: 'El Coach IA ajusta tu plan cada semana según lo que levantas de verdad.',
    bullets: ['Coach IA incluido, sin claves ni configuraciones', 'Progresión automática de cada ejercicio', 'Tus datos sincronizados en todos tus dispositivos'],
    timeline: 'Hoy: todo Pro desbloqueado · Día {0}: te avisamos · Día {1}: empieza el pago. Cancela en un toque.',
    cta: 'Empezar {0} días gratis',
    ctaNoTrial: 'Suscribirme',
    monthlyLabel: 'Mensual',
    annualLabel: 'Anual',
    annualBadge: 'Ahorra más',
    perMonth: '{0}/mes',
    perYear: '{0}/año',
    footnote: 'Registrar entrenamientos es siempre gratis. La suscripción se renueva sola; cancela cuando quieras.',
    later: 'Ahora no',
    endTitle: 'Tu prueba gratis ha terminado',
    endRecap: 'Durante tu prueba el Coach te hizo {adjustments} ajustes y subiste {gainKg} en {exercise}. Sigue con él.',
    endBody: 'Tus entrenamientos siguen aquí y puedes seguir registrándolos gratis. Para seguir con el Coach IA, elige un plan.',
    endCta: 'Seguir con el Coach IA'
  },
  en: {
    title: 'A coach that reviews your week',
    titleStall: 'Stop stalling on {exercise}',
    titleComeback: 'A few days off? The Coach can rework your week.',
    titleDay7: 'Your plan worked this week. Want the Coach to adjust it every Monday?',
    subtitle: 'The AI Coach adjusts your plan every week from what you actually lift.',
    bullets: ['AI Coach included — no keys, no setup', 'Automatic progression on every exercise', 'Your data synced across all your devices'],
    timeline: 'Today: all of Pro unlocked · Day {0}: we remind you · Day {1}: billing starts. Cancel in one tap.',
    cta: 'Start {0} days free',
    ctaNoTrial: 'Subscribe',
    monthlyLabel: 'Monthly',
    annualLabel: 'Yearly',
    annualBadge: 'Best value',
    perMonth: '{0}/month',
    perYear: '{0}/year',
    footnote: 'Logging workouts is always free. The subscription renews automatically; cancel anytime.',
    later: 'Not now',
    endTitle: 'Your free trial has ended',
    endRecap: 'During your trial the Coach made {adjustments} changes to your plan, and your {exercise} went up {gainKg}. Keep it going.',
    endBody: 'Your workouts are all still here, and logging stays free. To keep the AI Coach, pick a plan.',
    endCta: 'Keep the AI Coach'
  }
};
