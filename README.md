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
5. In spare time, **Research** lists your most common models. Open eBay's sold listings (or Terapeak), copy the page, paste it in. You can paste several pages at once.
   - **Every sale is kept for good, small and large parts.** Small parts feed the pull sheets. Large parts (engines, transmissions, doors, wheels…) are saved for when you start selling them.
   - Each paste **adds to** what's saved, and the same sale is never saved twice. Terapeak pastes ask for the date range you used, so the "sold per 90 days" numbers stay accurate.
   - Save for a range of years so one paste covers a whole generation.

## Updating after a code change
- **App page changes** (`index.html`) go live by themselves about a minute after they're on GitHub.
- **Server changes** (`supabase/functions/ebay-lookup/index.ts`) need a redeploy: copy the file from GitHub, paste it over the code in Supabase → Edge Functions → ebay-lookup, and click **Deploy**.
- **Database changes** (`supabase/schema.sql`): paste the whole file into the SQL Editor and click **Run**. It's safe to run again and never deletes data.

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
   - `ANTHROPIC_API_KEY`: for generations and reading part photos
   - `EBAY_RUNAME`: for listing on eBay (see "Selling on eBay" below)

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

## Selling on eBay from the Shelf (one-time, about 10 minutes)
1. **Get your RuName.** In the eBay developer portal open **User Tokens** for your **Production** keyset → **Get a Token from eBay via Your Application** → **Add eBay Redirect URL**.
   - **Your auth accepted URL:** `https://YOUR-PROJECT-REF.supabase.co/functions/v1/ebay-lookup`
   - **Your auth declined URL:** the same address
   - **Privacy policy URL:** your app address works (`https://sumbreezy.github.io/quickpull/`)
   - Save. eBay shows a name like `Theran_Xxxx-QuickPul-PRD-abc123`. That is the **RuName**.
2. In Supabase → **Edge Functions → Secrets**, add `EBAY_RUNAME` = that RuName.
3. On eBay (the seller account), make sure you have **Business policies** for shipping, payment, and returns (eBay → Account → Business policies).
4. In the app: **Settings → eBay selling → Connect eBay account**, sign in to your seller account, and accept. Then pick your three policies, enter your ship-from ZIP, and Save.

How a listing works: **Shelf → Photos & list on eBay** → add photos (label close-up first) → **Read photos with AI** (part number + grade; needs `ANTHROPIC_API_KEY`) → check and **Looks right, save** → **Write listing** → check the title, price, category, fitment and specifics → **Publish to eBay**.
- Fitment starts as **this car only**. Widen it only when you're sure the part number matches across those years.
- Every confirmed part number goes into your own "same part, different car" list.
- When it sells on eBay, the app marks it Sold with the real price (checked every 15 minutes).
- If eBay rejects a listing, its exact message shows on the part. Fix that field and publish again.

## Claude in Chrome research (optional)
Claude in Chrome can work through **Research → Let Claude in Chrome do it**. It opens each model's public eBay sold page, reads it, and saves it the same way a paste would, covering the whole generation.
- Use a Chrome profile that is **not** signed in to eBay, with QuickPull open and signed in.
- Save the **quickpull-chrome-research** skill once, then ask Claude: "research my QuickPull queue in Chrome".
- Each run does at most 10 models and waits about 30 seconds between pages. It stops on its own at any captcha, sign-in page or block page.

## Listing templates
When you tap **Write listing**, QuickPull learns from what sells for that part. It reads your saved sold titles plus the top 3 live eBay listings, and Claude works out the title order, common item specifics, and what the best listings photograph. That is cached per model and part for 30 days.
- Words that make a claim about the part ("Tested", "Working", "No cracks") are **never** added automatically. They show as **+ suggestions** you add only when they're true.

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
