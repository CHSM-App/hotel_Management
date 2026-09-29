import { Link } from 'react-router-dom';
import './PrivacyPolicy.css';

const EFFECTIVE_DATE = 'September 29, 2026';
const SUPPORT_EMAIL = 'support@vengurlatech.com';
const COMPANY = 'VengurlaTech';

export default function PrivacyPolicy() {
  return (
    <div className="policy-page">
      <div className="policy-shell">
        <aside className="policy-nav">
          <Link to="/login" className="policy-back">
            ← Back to sign in
          </Link>
          <p className="policy-nav__title">On this page</p>
          <nav>
            <a href="#overview">1. Overview</a>
            <a href="#who-we-are">2. Who this applies to</a>
            <a href="#data-we-collect">3. Data we collect</a>
            <a href="#how-we-use">4. How we use data</a>
            <a href="#legal-basis">5. Legal basis for processing</a>
            <a href="#sharing">6. Sharing &amp; third parties</a>
            <a href="#storage-security">7. Storage &amp; security</a>
            <a href="#retention">8. Data retention</a>
            <a href="#rights">9. Your rights</a>
            <a href="#account-deletion">10. Account &amp; data deletion</a>
            <a href="#permissions">11. App permissions</a>
            <a href="#children">12. Children's privacy</a>
            <a href="#international">13. International transfer</a>
            <a href="#changes">14. Changes to this policy</a>
            <a href="#contact">15. Contact us</a>
          </nav>
        </aside>

        <main className="policy-card">
          <p className="policy-eyebrow">Privacy Policy</p>
          <h1>How we handle your data</h1>
          <p className="policy-updated">Effective date: {EFFECTIVE_DATE}</p>

          <section id="overview">
            <h2>1. Overview</h2>
            <p>
              This Privacy Policy describes how {COMPANY} ("we", "us", "our") collects, uses,
              stores, shares and protects information through the hotel/lodge management
              platform (the "Service"), comprising the web application and the companion
              Android/iOS mobile app used by property staff (together, the "App"). By using
              the Service, you agree to the practices described here.
            </p>
          </section>

          <section id="who-we-are">
            <h2>2. Who this applies to</h2>
            <p>The Service has two categories of individuals whose data it processes:</p>
            <ul>
              <li>
                <strong>Staff users</strong> — property owners, receptionists, kitchen and
                other staff who hold a login to the Service, provisioned by their property.
              </li>
              <li>
                <strong>Guests</strong> — individuals who stay at, or place orders with, a
                property that uses the Service. Guests do not hold an account; their data is
                entered by property staff in the course of a booking, check-in or order.
              </li>
            </ul>
            <p>
              Each hotel/lodge ("Property") is the data controller for its guests' personal
              data; {COMPANY} acts as a data processor providing the software the Property
              uses to record and manage that data. Staff-account data is controlled jointly
              by {COMPANY} and the Property that provisions the account.
            </p>
          </section>

          <section id="data-we-collect">
            <h2>3. Data we collect</h2>

            <h3>3.1 Staff account data</h3>
            <ul>
              <li>Name, phone number (required, used as the primary login identifier) and email (optional).</li>
              <li>Password, stored only as a salted, irreversible hash — we never store or can view your plain-text password.</li>
              <li>Role and permissions within the Property, and account status (active/inactive).</li>
            </ul>

            <h3>3.2 Guest data, entered by Property staff</h3>
            <ul>
              <li>Guest name and phone number.</li>
              <li>
                Government ID details for check-in/KYC purposes: ID type, either a typed ID
                number (e.g. Aadhaar, passport, driving licence) or a scanned/photographed
                copy of the ID document.
              </li>
              <li>Number of occupants, including whether an occupant is a child (for room pricing and occupancy records only).</li>
              <li>Booking details: dates, room, rate, advance payment amount, payment method (cash/UPI/card) and a payment reference number.</li>
              <li>Food/room-service orders placed during the stay, and a food PIN used to authenticate room-service requests.</li>
            </ul>
            <p className="policy-note">
              We do not collect or store card numbers, CVV or other card credentials. Card
              and UPI payments happen outside the Service (e.g. at a bank's or payment
              app's own interface); we only record that a payment was made and its
              reference number, for the Property's own bookkeeping.
            </p>

            <h3>3.3 Property/business data</h3>
            <ul>
              <li>Property name, address and geographic coordinates (used to show the Property's location on its public page).</li>
              <li>Menus, room and asset details, vendor contacts, staff rosters, expenses and income records maintained by the Property.</li>
              <li>Photographs of rooms, venues, menu items and the Property's logo, uploaded by staff.</li>
            </ul>

            <h3>3.4 Technical data</h3>
            <ul>
              <li>Login session tokens, used to keep you signed in (see Section 7).</li>
              <li>Basic activity logs (e.g. sign-in timestamps) used to secure accounts and diagnose issues.</li>
            </ul>
            <p>
              We do not use analytics, advertising or crash-reporting SDKs, and we do not
              serve ads or sell data to advertisers.
            </p>
          </section>

          <section id="how-we-use">
            <h2>4. How we use data</h2>
            <ul>
              <li>To operate core features: bookings, check-in/KYC records, billing, food orders, staff and asset management.</li>
              <li>To authenticate staff logins and enforce role-based access within a Property.</li>
              <li>To send booking confirmations, bill/share links and one-time passcodes (OTPs) for password resets, via SMS/WhatsApp.</li>
              <li>To generate reports (e.g. income, occupancy) for the Property's own management use.</li>
              <li>To maintain the security, integrity and availability of the Service.</li>
              <li>To comply with legal obligations, such as retaining guest register records where required by local law (e.g. police/tourism regulations on guest registers).</li>
            </ul>
          </section>

          <section id="legal-basis">
            <h2>5. Legal basis for processing</h2>
            <p>Where applicable data protection law requires a stated legal basis, we rely on:</p>
            <ul>
              <li><strong>Contract</strong> — processing staff and guest data is necessary to provide the booking/hospitality service requested.</li>
              <li><strong>Legal obligation</strong> — retaining guest ID/register data as required by hospitality, tourism or police regulations.</li>
              <li><strong>Legitimate interests</strong> — securing accounts, preventing fraud, and improving the Service.</li>
              <li><strong>Consent</strong> — where a Property or guest is asked to separately opt in (e.g. optional communications).</li>
            </ul>
          </section>

          <section id="sharing">
            <h2>6. Sharing &amp; third parties</h2>
            <p>We do not sell personal data. We share data only as follows:</p>
            <ul>
              <li>
                <strong>Within a Property</strong> — staff of the same Property can see guest
                and booking data relevant to their role.
              </li>
              <li>
                <strong>Messaging provider</strong> — guest phone numbers and booking/billing
                details (e.g. confirmations, bill-share links) and staff OTP codes are sent
                via a third-party WhatsApp/SMS delivery provider strictly to deliver that
                message.
              </li>
              <li>
                <strong>Hosting/infrastructure</strong> — data is stored on secured servers
                operated by our hosting/database provider, solely to run the Service.
              </li>
              <li>
                <strong>Legal requirements</strong> — we may disclose data if required by law,
                regulation, or a valid request from a government or law-enforcement authority
                (for example, hotel guest-register requirements).
              </li>
              <li>
                <strong>Business transfers</strong> — if {COMPANY} is involved in a merger,
                acquisition or asset sale, data may be transferred as part of that transaction,
                subject to this policy.
              </li>
            </ul>
          </section>

          <section id="storage-security">
            <h2>7. Storage &amp; security</h2>
            <ul>
              <li>Passwords are stored as irreversible salted hashes, never in plain text.</li>
              <li>ID-proof documents are stored on access-controlled servers with randomized, non-guessable filenames, and are only retrievable through authenticated staff requests — they are not publicly accessible.</li>
              <li>The web app keeps your sign-in session in your browser's local storage; the mobile app keeps it in the device's secure hardware-backed keystore. Signing out clears this session.</li>
              <li>We restrict access to personal data to staff and systems that need it to operate the Service.</li>
              <li>No method of transmission or storage is 100% secure; we work to protect your data but cannot guarantee absolute security.</li>
            </ul>
          </section>

          <section id="retention">
            <h2>9. Data retention</h2>
            <p>
              We retain staff and guest data for as long as the Property's account is active,
              and afterwards only as needed to meet legal, tax, or regulatory retention
              requirements (such as guest-register rules), resolve disputes, and enforce our
              agreements. A Property may request deletion of its data at any time, subject to
              those legal retention obligations. Staff accounts are deactivated by their
              Property admin when no longer needed.
            </p>
          </section>

          <section id="rights">
            <h2>9. Your rights</h2>
            <p>Subject to applicable law (including India's Digital Personal Data Protection Act, and GDPR/CCPA where they apply), you may have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data (see Section 10).</li>
              <li>Withdraw consent, where processing is based on consent.</li>
              <li>Object to or request restriction of certain processing.</li>
              <li>Lodge a complaint with your local data protection authority.</li>
            </ul>
            <p>
              Guests should direct these requests to the Property they stayed with, or to us
              at the contact below; we will coordinate with the Property where it is the
              controller of that data.
            </p>
          </section>

          <section id="account-deletion">
            <h2>10. Account &amp; data deletion</h2>
            <p>You can request deletion of a staff account and its associated personal data at any time:</p>
            <ol>
              <li>
                Email <strong>{SUPPORT_EMAIL}</strong> from the phone/email registered on the
                account, with the subject "Account deletion request".
              </li>
              <li>Include your registered phone number or email so we can locate your account.</li>
              <li>
                We will verify the request and delete the account and personal data within 30
                days, except for data we must keep to meet legal, tax or regulatory
                obligations (for example, billing records required by tax law, or guest
                register data required by hospitality regulations) — that data is retained
                only as long as legally required and then deleted.
              </li>
            </ol>
            <p>
              Guests wishing to have their data deleted should contact the Property they
              stayed with, or email us at {SUPPORT_EMAIL} and we will forward the request to
              the relevant Property.
            </p>
          </section>

          <section id="permissions">
            <h2>11. App permissions (mobile app)</h2>
            <p>The Android/iOS staff app requests the following device permissions, used only as described:</p>
            <ul>
              <li><strong>Camera</strong> — to photograph guest ID documents, assets or menu items during data entry.</li>
              <li><strong>Location</strong> — to let staff pinpoint the Property's own address on a map during onboarding; not used to track guest or staff movement.</li>
              <li><strong>Internet</strong> — required to sync data with our servers.</li>
            </ul>
            <p>Permissions can be reviewed and revoked at any time in your device's app settings.</p>
          </section>

          <section id="children">
            <h2>12. Children's privacy</h2>
            <p>
              The Service is intended for use by adult hospitality staff and is not directed
              at children. We do not knowingly collect personal data from children as account
              holders. A child's status as an occupant may be recorded solely as part of a
              guest booking's headcount (for pricing/occupancy purposes), by the accompanying
              adult guest.
            </p>
          </section>

          <section id="international">
            <h2>13. International data transfer</h2>
            <p>
              Data is primarily stored and processed on servers located in India. If we or
              our service providers process data outside your country, we take steps to
              ensure it receives an equivalent level of protection as described in this
              policy.
            </p>
          </section>

          <section id="changes">
            <h2>14. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. Material changes will be reflected
              by updating the "Effective date" above, and, where required by law, we will
              provide additional notice.
            </p>
          </section>

          <section id="contact">
            <h2>15. Contact us</h2>
            <p>
              For privacy questions, data requests, or account deletion, contact us at{' '}
              <strong>{SUPPORT_EMAIL}</strong>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
