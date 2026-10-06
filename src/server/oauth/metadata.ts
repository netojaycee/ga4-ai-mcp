import { OAUTH, PATHS } from "./config";

/** RFC 9728 protected resource metadata. */
export function protectedResourceMetadata(baseUrl: string, mcpUrl: string) {
  return {
    resource: mcpUrl,
    authorization_servers: [baseUrl],
    scopes_supported: [...OAUTH.scopes],
    bearer_methods_supported: ["header"],
  };
}

/** RFC 8414 authorization server metadata. Issuer has no path, so only the root well-known URL applies. */
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}${PATHS.authorize}`,
    token_endpoint: `${baseUrl}${PATHS.token}`,
    registration_endpoint: `${baseUrl}${PATHS.register}`,
    revocation_endpoint: `${baseUrl}${PATHS.revoke}`,
    scopes_supported: [...OAUTH.scopes],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}
