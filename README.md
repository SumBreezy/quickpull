# QuickPull

Check in every car you buy by pasting its VIN. QuickPull looks up which small, valuable parts on that car sell used on eBay,
remembers it for every car like it, and tells the yard where the car goes: **Pull area** or **Shred**.

- `index.html` + `config.js`: the app (GitHub Pages)
- `supabase/schema.sql`: database, roles, and security rules
- `supabase/functions/ebay-lookup/index.ts`: server code for eBay, the VIN decoder, and the paste reader
- `supabase/cron.sql`: the background timer

## How the yard uses it
1. **Check-in** pastes VINs (one or sixty) and taps **Check in**. Each car gets a stock number like `1030-07`. Write it on the windshield.
2. Models already in the database get their destination instantly. New models are gathered in the background (about 62 eBay lookups each, under eBay's 5,000-a-day limit).
3. The owner opens any car to see its **pull sheet**: tracked parts plus anything else of value eBay shows for that model ("Also found"). Parts under the cutoff ($60 to start) are hidden, never deleted.
4. Pulled parts get a grade (A/B/C) and a bin (A–H by part type) and move through **Shelf** → Listed → Sold.
5. In spare time, **Research** lists your most common models. Open eBay's sold listings, copy the page, paste it in. That one paste covers every part on that model, and you can apply it to a range of years.

## One-time setup (about 20 minutes)

### 1. Supabase project
1. At supabase.com, click **New project** and name it `quickpull`.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**. Do the same for the check-in person.
4. Open **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up".

### 2. The server function
1. Open **Edge Functions → Deploy a new function → Via Editor** and name it exactly `ebay-lookup`.
2. Replace the sample code with all of `supabase/functions/ebay-lookup/index.ts` and click **Deploy**.
3. Open the function's **Details** and turn **off "Enforce JWT verification"**. The function checks logins itself, and the timer needs this off.
4. Open **Edge Functions → Secrets** and add:
   - `EBAY_CLIENT_ID`: eBay **Production** App ID
   - `EBAY_CLIENT_SECRET`: eBay **Production** Cert ID
   - `CRON_SECRET`: any long random text, for example 30 random letters and numbers
   - Only if the app later says "The function can't reach the database": `QP_SECRET_KEY`, set to the **secret** key from Project Settings → API Keys (starts with `sb_secret_`)
   - Only if eBay approves Marketplace Insights: `EBAY_INSIGHTS` = `on`

### 3. The background timer
Follow the three lines at the top of `supabase/cron.sql`, then run it in the SQL Editor.
Without the timer, gathering only runs while someone has the Check-in page open.

### 4. Point the app at your project
1. Open **Project Settings → API Keys**. Copy the Project URL and the **publishable** key (it starts with `sb_publishable_`).
2. On GitHub, edit `config.js`, paste both values in place of the `PASTE_...` text, and commit.

### 5. Put it online
On GitHub, open **Settings → Pages → Deploy from a branch → main → / (root) → Save**.
After a minute, the app is at `https://sumbreezy.github.io/quickpull/`. On iPhone, open it in Safari and tap **Share → Add to Home Screen**.

### 6. First sign-in
**Sign in yourself first.** The first person to sign in becomes the owner. Everyone else starts as check-in, which only sees the Check-in page.
You can change roles in **Settings → Team**.

## If something doesn't work
- **"eBay keys are missing or wrong"**: use the **Production** keys, not Sandbox.
- **Settings shows the background timer as "Not running yet"**: re-check the project ref and secret in `cron.sql`, and that JWT verification is off.
- **Camera won't open**: allow camera access for the site in Safari.

## Tuning
- **Fees, packing costs, and bins:** at the top of the script in `index.html`.
- **The tracked parts list and the title rules:** at the top of the function file. Redeploy after changing it.
- **Prices:** "clean" = top 25% of used OEM prices (what a good one brings), "typical" = median, "rough" = bottom 25%.
  - Junk, broken, aftermarket, new, and "for parts" listings are always left out.
  - Pulled parts are listed at the price for their grade: A = clean, B = typical, C = rough.
