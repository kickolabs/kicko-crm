// Temporary ("throwaway") email services, refused at sign-up so a free trial can't be
// claimed again and again with fresh inboxes. Common domains from the public
// disposable-email-domains lists; extend without a deploy via BLOCKED_EMAIL_DOMAINS
// (comma-separated). Subdomains match too (x.mailinator.com).

const DOMAINS = `
0-mail.com 10minutemail.com 10minutemail.net 10minutemail.co.uk 10minemail.com 20minutemail.com 33mail.com
anonbox.net anonymbox.com binkmail.com bobmail.info boximail.com burnermail.io byom.de
chacuo.net crazymailing.com cuvox.de dayrep.com deadaddress.com discard.email discardmail.com discardmail.de
dispostable.com dodgit.com dropmail.me drdrb.com dump-email.info easytrashmail.com einrot.com emailondeck.com
emailfake.com emailtemporanea.net emltmp.com etranquil.com fakeinbox.com fakemail.net fakemailgenerator.com
fastacura.com filzmail.com fleckens.hu getairmail.com getnada.com gishpuppy.com grr.la guerrillamail.biz
guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com
gustr.com harakirimail.com hidemail.de hmamail.com inboxbear.com inboxkitten.com incognitomail.org instantemailaddress.com
jetable.org jourrapide.com kasmail.com killmail.net klzlk.com kurzepost.de linshiyouxiang.net luxusmail.org
mail-temp.com mail.tm mailcatch.com maildrop.cc mailexpire.com mailforspam.com mailinator.com mailinator.net
mailinator2.com mailmetrash.com mailnesia.com mailnull.com mailsac.com mailtemp.info mailtothis.com mailzilla.com
meltmail.com mintemail.com moakt.com mohmal.com mt2015.com mvrht.com mytemp.email mytrashmail.com nada.email
nospam.ze.tc nowmymail.com objectmail.com one-time.email onewaymail.com owlymail.com proxymail.eu rcpt.at
rhyta.com rmqkr.net sharklasers.com shieldemail.com smashmail.de snapmail.cc sofimail.com spam4.me spamavert.com
spambog.com spambox.us spamex.com spamfree24.org spamgourmet.com spamherelots.com spamhole.com spaml.de
superrito.com teleworm.us temp-mail.io temp-mail.org temp-mail.ru tempail.com tempemail.co tempemail.net
tempinbox.com tempmail.dev tempmail.net tempmail.plus tempmailo.com tempmailaddress.com tempr.email
temporarymail.com throwam.com throwawaymail.com tmail.ws tmailinator.com tmpmail.net tmpmail.org trash-mail.com
trashmail.at trashmail.com trashmail.de trashmail.me trashmail.net trashmailer.com trbvm.com tyldd.com
wegwerfmail.de wegwerfmail.net wh4f.org yopmail.com yopmail.fr yopmail.net zoemail.org zetmail.com
`.split(/\s+/).filter(Boolean);

const BUILT_IN = new Set(DOMAINS);
const extra = () => (process.env.BLOCKED_EMAIL_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

export function isDisposableEmail(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  const parts = domain.split('.');
  const added = extra();
  // mail.yopmail.com → yopmail.com
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    if (BUILT_IN.has(d) || added.includes(d)) return true;
  }
  return false;
}

export const DISPOSABLE_EMAIL_MESSAGE = 'Please use your work or personal email. Temporary email addresses can’t be used.';
