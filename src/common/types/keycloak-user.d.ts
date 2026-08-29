export {};

declare global {
  interface IKeycloakUser {
    id: string;
    email?: string;
    username?: string;
    name?: string;
  }
}
