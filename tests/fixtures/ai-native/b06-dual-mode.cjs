'use strict';
const platformRows = Object.freeze([
  { mode: 'platform_managed', enabled: true, availability: 'ready', connectionState: 'not_tested', serviceName: 'Rental OS AI', routing: 'automatic' },
  { mode: 'platform_managed', enabled: false, availability: 'unavailable', connectionState: 'not_tested', serviceName: 'Rental OS AI', routing: 'automatic' },
]);
const tenantRows = Object.freeze([
  { mode: 'tenant_managed', enabled: true, credentialState: 'configured', connectionState: 'verified_live', protocol: 'openai_compatible', model: 'synthetic/model' },
  { mode: 'tenant_managed', enabled: true, credentialState: 'missing', connectionState: 'failed', protocol: 'openai_compatible', model: 'synthetic/model' },
  { mode: 'tenant_managed', enabled: false, credentialState: 'rotation_required', connectionState: 'not_tested', protocol: 'openai_compatible', model: 'synthetic/old-model' },
]);
module.exports = Object.freeze({ platformRows, tenantRows });
