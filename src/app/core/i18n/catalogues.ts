/**
 * The four translation catalogues, compiled into the bundle rather than fetched.
 *
 * `web/` loads its `i18n/*.json` over HTTP through `@ngx-translate/http-loader`. That is wrong here
 * for two reasons. The app is offline-first — the Today tab is expected to render from the encrypted
 * cache with no network at all — and a fetched catalogue means the first paint after a cold start on
 * a plane is either untranslated or blocked on a request that will never complete. And it would add
 * a dependency for what is a few kilobytes of static text; `mobile-app-plan.md` already names
 * dependency count as this app's most fragile property.
 *
 * The cost is that a language change ships in a release rather than a deploy, which for four
 * languages that change rarely is the better trade.
 *
 * **Every catalogue must have identical keys.** ngx-translate renders a missing key as the key
 * itself — `me.title` in the middle of a screen — rather than failing, so drift is invisible until
 * someone switches language. `catalogues.spec.ts` compares the key sets and is the gate.
 */

export const EN = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    retry: 'Retry',
    loading: 'Loading…',
    offline: 'You are offline',
  },
  tabs: {
    today: 'Today',
    messages: 'Messages',
    documents: 'Documents',
    me: 'Me',
  },
  me: {
    title: 'Me',
    profile: 'Profile',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    phone: 'Mobile phone',
    saved: 'Profile saved',
    saveFailed: 'Could not save your profile',
    loadFailed: 'Could not load your profile',
    language: 'Language',
    shareRoster: 'Share my roster',
    shareUnavailable: 'Sharing is not available on this device',
    noRoster: 'No upcoming assignments to share',
    rosterTitle: 'My duty roster',
    signOut: 'Sign out',
    signOutConfirm: 'Sign out of this device?',
    signOutDetail: 'Your cached patient data and messages will be erased from this phone.',
  },
};

export const ES: typeof EN = {
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    retry: 'Reintentar',
    loading: 'Cargando…',
    offline: 'Está sin conexión',
  },
  tabs: {
    today: 'Hoy',
    messages: 'Mensajes',
    documents: 'Documentos',
    me: 'Yo',
  },
  me: {
    title: 'Yo',
    profile: 'Perfil',
    firstName: 'Nombre',
    lastName: 'Apellidos',
    email: 'Correo electrónico',
    phone: 'Teléfono móvil',
    saved: 'Perfil guardado',
    saveFailed: 'No se pudo guardar su perfil',
    loadFailed: 'No se pudo cargar su perfil',
    language: 'Idioma',
    shareRoster: 'Compartir mi turno',
    shareUnavailable: 'Compartir no está disponible en este dispositivo',
    noRoster: 'No hay turnos próximos para compartir',
    rosterTitle: 'Mi turno de servicio',
    signOut: 'Cerrar sesión',
    signOutConfirm: '¿Cerrar sesión en este dispositivo?',
    signOutDetail: 'Los datos de pacientes y mensajes en caché se borrarán de este teléfono.',
  },
};

export const FR: typeof EN = {
  common: {
    save: 'Enregistrer',
    cancel: 'Annuler',
    retry: 'Réessayer',
    loading: 'Chargement…',
    offline: 'Vous êtes hors ligne',
  },
  tabs: {
    today: "Aujourd'hui",
    messages: 'Messages',
    documents: 'Documents',
    me: 'Moi',
  },
  me: {
    title: 'Moi',
    profile: 'Profil',
    firstName: 'Prénom',
    lastName: 'Nom',
    email: 'Email',
    phone: 'Téléphone mobile',
    saved: 'Profil enregistré',
    saveFailed: "Impossible d'enregistrer votre profil",
    loadFailed: 'Impossible de charger votre profil',
    language: 'Langue',
    shareRoster: 'Partager mon planning',
    shareUnavailable: "Le partage n'est pas disponible sur cet appareil",
    noRoster: 'Aucune affectation à venir à partager',
    rosterTitle: 'Mon planning de garde',
    signOut: 'Se déconnecter',
    signOutConfirm: 'Se déconnecter de cet appareil ?',
    signOutDetail: 'Les données patients et les messages en cache seront effacés de ce téléphone.',
  },
};

export const DE: typeof EN = {
  common: {
    save: 'Speichern',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    loading: 'Wird geladen…',
    offline: 'Sie sind offline',
  },
  tabs: {
    today: 'Heute',
    messages: 'Nachrichten',
    documents: 'Dokumente',
    me: 'Ich',
  },
  me: {
    title: 'Ich',
    profile: 'Profil',
    firstName: 'Vorname',
    lastName: 'Nachname',
    email: 'E-Mail',
    phone: 'Mobiltelefon',
    saved: 'Profil gespeichert',
    saveFailed: 'Ihr Profil konnte nicht gespeichert werden',
    loadFailed: 'Ihr Profil konnte nicht geladen werden',
    language: 'Sprache',
    shareRoster: 'Meinen Dienstplan teilen',
    shareUnavailable: 'Teilen ist auf diesem Gerät nicht verfügbar',
    noRoster: 'Keine bevorstehenden Einsätze zum Teilen',
    rosterTitle: 'Mein Dienstplan',
    signOut: 'Abmelden',
    signOutConfirm: 'Von diesem Gerät abmelden?',
    signOutDetail: 'Zwischengespeicherte Patientendaten und Nachrichten werden von diesem Telefon gelöscht.',
  },
};

/** The languages this app ships, matching `web/`'s four exactly. */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const CATALOGUES: Record<SupportedLanguage, typeof EN> = { en: EN, es: ES, fr: FR, de: DE };

/** Shown in the language picker, each in its own language rather than translated. */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};
