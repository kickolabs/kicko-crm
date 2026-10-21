import { whatsappCloud } from '../messaging/whatsapp-cloud';
import { whatsappSandbox } from '../messaging/whatsapp-sandbox';
import { paymentsSandbox } from '../payments/sandbox';
import { razorpay } from '../payments/razorpay';
import { exotel } from '../telephony/exotel';
import { telephonySandbox } from '../telephony/sandbox';
import { twilio } from '../telephony/twilio';
import { bolna } from '../voice/bolna';
import { retell } from '../voice/retell';
import { voiceSandbox } from '../voice/sandbox';
import type { Capability, ProviderDescriptor } from './types';

// Every agency-connectable provider. Adding a provider = write an adapter file
// and list it here; the Integrations page, connect form and webhooks pick it up.

export const PROVIDERS: ProviderDescriptor[] = [
  whatsappCloud,
  whatsappSandbox,
  razorpay,
  paymentsSandbox,
  exotel,
  twilio,
  telephonySandbox,
  bolna,
  retell,
  voiceSandbox,
] as ProviderDescriptor[];

/** Capabilities agencies connect themselves, in display order. */
export const TENANT_CAPABILITIES: Capability[] = ['messaging', 'payments', 'telephony', 'voice_agent'];

export const descriptorFor = (capability: string, provider: string) =>
  PROVIDERS.find((p) => p.capability === capability && p.id === provider);

export const providersFor = (capability: Capability) => PROVIDERS.filter((p) => p.capability === capability);
