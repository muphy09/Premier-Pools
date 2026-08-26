## [3.3.0] - 8/26/26
### *New Feature* - Price Impact
- Updated for ALL categories
- Cost is broken down by Direct Charges and Indirect Charges
    - Direct Charges are costs that contribute to the parent category
    - Indirect Charges are costs that contribute to seperate categories
    - Example: Item = Pump
        - Direct Charge = Equipment Cost
        - Indirect Charge = Interior Finish Fittings (not billed to equipment)
- Price Impact can be shown in Retail or COGS prices and can be disabled entirely in the User Settings
    - Admins have the ability to globally disable Price Impact for their franchise
-----
## [3.2.6] - 8/26/26
### HOTFIX
- Fixed a visual bug in the Proposal Summary when calculating the total savings of the proposal
-----
-----
## [3.2.3] - 8/25/26
### HOTFIX
- Squashed a bug that prevented manual adjustments from recalculating correctly
-----
## [3.2.2] - 8/25/26
### Equipment Category UI Redesign
- Subcategory items are now toggle items and are displayed in 2 adaptable columns
- Icons now display alongside equipment items
- Package Options selection UI has been updated to match the look
- All 'Add Another' items appear consistent
### Admin Pricing Editor
- Exposed the 'COGS Overhead' cost input inside of the Discounts/Adjustments category
### Cloud Server Update
- Reworked an unread poll that was utilizing too much data for each user
### Misc.
- Renamed 'Admin Settings' to 'Franchise Settings' for clarity
-----
## [3.2.1] - 8/24/26
### HOTFIX
- Fixed an issue introduced in 3.1.3 preventing designers from building another version of a proposal
-----
## [3.2.0] - 8/24/26
### COGS Breakdown UI Redesign
- Updated the COGS Breakdown UI to a 'Summary' and 'Detailed' landscape page view
    - Exporting retains the same UI
- Groundwork set for Bookkeeper UI update
- Introduced a new category for 'COGS Overhead' to detail the overhead cost
### Mark as Off-Contract
- Updated the UI inside Custom Options from a checkbox to a toggle
-----
## [3.1.3] - 8/24/26
### Bugfix
- Fixed an issue where a proposal could appear blank if it's pricing information did not finish loading
    - If loading fails, users can 'retry' without risking changes to the proposal
    - Added protections to prevent blank or incomplete proposal data from overwriting the cloud data
    - Improved offline save functionality
-----
## [3.1.2] - 8/17/26
### Bugfix
- Corrected an issue that caused *a few* proposals created before June to silently inherit calculation changes that were made to the pricing engine in subsequent updates
    - Affected proposals will be prompted to create a new version with the corrected pricing
        - Original Version can still be used / accessed if needed
-----
## [3.1.0] - 8/4/26
### Navigation Tabs
- Reworked the top header navigation into a side column navigation to free up more space
- Moved the 'Admin Settings' icon into a navigation tab
- Moved the 'User Profile' icon into the bottom of the navigation tab
- Moved the 'Feedback' icon into the bottom of the navigation tab
### Dashboard Interface
- Removed the Hero Title in favor of 'Recent Activity' Tiles
- Animation effects added to dashboard elements
- Maximum proposals displayed in the table now depends on your monitor size/resolution
    - This feature will dynamically adjust to add/remove rows to fill the screen
### Admin Panel
- Redesigned the UI of the Admin Panel for clarity and consitency
- Removed information blocks in favor of buttons in the top navigation
- Reworked Admin Proposal Table to a consistent format and style
- Introduced 'At a Glance' information for the Proposal Table
- Introduced new filter options for the Proposal Table
- Exposed multiple cost variables previously hardcoded into the Pricing Engine
- Removed the 'Field Help' block (information is already included in the 'i' tooltip)
### Vertical Monitor Setups
- Adjusted UI to dynamically adapt to a vertical monitor display
    - *This feature may not work as intended in some areas, feedback is appreciated*
### Proposal Builder
- Navigation spaced consistently
- Category title moved to be underneath the pricing options
### Proposal Summary Screen
- Moved the 'Build Another Version' button into the Versions & Addendums block
### Fiberglass Pool Dimensions
- Implemented backend structure to support admin-entered fiberglass pool dimensions automatically
    - *Testing pricing for this feature - will be rolled out in a hotfix shortly*
### Bug Fixes
- Fixed an overlay issue when scrolling inside of popups
    - No longer scrolls the window behind it
- Fixed a pagination issue when changing pages with a large number of proposals
- Fixed a feedback issue when the Master account replies to a user on an *outdated* app version
-----
## [3.0.8] - 8/3/26
### Hotfix
- Legacy proposals with broken local data are now isolated on inital load
-----
## [3.0.7] - 8/3/26
### Legacy Proposal Rendering
- Adjusted niche legacy proposals to render after opening instead of on the dashboard
### Dashboard Rendering
- Adjusted all proposals to sync locally on the dashboard and render actively when opened
-----
## [3.0.6] - 7/29/26
### Tile Trim Selection
- Updated the selection of Tile Trim to include more options
    - Options can be configured inside of the Admin Pricing Menu
    - Previous proposals using a Trim Tile selection have been updated to the new format "Default Trim Tile"
### Proposal Version Pricing
- Copied proposal versions now retain the source version's immutable Pricing Model revision, financial adjustments, calculated pricing, contract overrides, and warranty selections.
- Changing the Pricing Model on the copied version remains an explicit designer action and recalculates only that version.
- Versions created from scratch now start from the newest active Pricing Model instead of inheriting the proposal container's older revision.
### Misc.
- Scrolling behavior in the Admin Pricing Menu improved
-----
## [3.0.5] - 7/18/26
### Resolution Scaling
- Numerous structural changes to satisfy different screen sizes & resolutions
    - Fixed an issue with 16:10 aspect ratio displays
    - Adjusted formatting to better fit vertical displays
- Multiple proposals now condense into pages on the Dashboard and Admin Panel
-----
## [3.0.4] - 7/17/26
### Admin Pricing
- Organized optional builder costs into Additional Features tables under Pool Specifications, Excavation, and Interior Finish
### Testing Accounts
- Created isolated testing accounts for Designer, Book Keeper, Admin, and Owner roles
- Testing proposals and workflow actions are stored separately and never appear in the franchise's live proposal workflow
-----
## [3.0.2] - 7/17/26
### Patch Notes Permissions
- Designers can now open Patch Notes and view notes published for their franchise
- Global patch notes remain available only to franchise owners & admins
-----
## [3.0.1] - 7/17/26
### Revision Storage and Workflow
- When an Admin updates a Pricing Model or Contract Template:
    - A new immutable revision is created
    - Existing proposals continue using their (old) pinned revision in every workflow state
    - New proposals use the newest published revision
    - Opening an older proposal presents: “Your Admin has made changes to this Pricing Model. Upgrade to the newest version?”
        - 'No' keeps the old prices permanently and asks again next time
        - 'Yes' previews the recalculated proposal before committing the upgrade
        - 'Compare' breaks down all changes that affect the current proposal
    - The previous proposal version remains recoverable
    - Actions are logged in the Ledger
### Offline Functionality
- Hardened offline operation and synchronization when reconnecting
- Admin settings can no longer be accessed while offline
### Permission Matrix
- Restructured backend roles to align with franchise isolation
    - RLS updated to prevent unauthorized access to designer permissions
- Added explicit proposal ownership and routed sensitive data through permission checks
    - Foundation added for future proposal transfers
- Restructured Admin Settings to verify the correct PIN online
    - Admin Settings cannot be accessed while offline
### Franchise Segregation
- Restructured framework of the backend to support updating franchises independently (or globally)
    - New app version extension indicates which version of your franchise branch you are running
    - Patch Notes appear per franchise & global (if updated globally)
- Contract Uploads, Pricing Models, UI, Calculations/Formulas, and roles can be independently updated
- Staging sandbox introduced for controlled testing between sanitized environments
-----
## [2.4.7] - 7/10/26
### Contract Changes
- Line item for Phone II can now be edited properly
### Autofill Systems
- Electric Autofill now separates Conduit run and Plumbing run instead of using the same value
-----
## [2.4.6] - 7/6/26
### PMF03 Logic
- Adjusted the logic of Additional Pumps in package PMF03
    - Categorized the Water Features into 'Groups'
        - An Additional Pump is required when 2 unique water feature 'Groups' are added
        - Quantity added in a single group no longer impacts an Additional Pump
- Added tooltip helpers to explain why the pump was added & cannot be removed
-----
## [2.4.4] - 7/6/26
### PMF03 Hotfix
- Corrected an issue with package PMF03 where an additional pump was injected accidentally
-----
## [2.4.3] - 6/24/26
### Contract Update
- Line 73 now populates "5 Year Warranty on Equipment" by default on all Standard Price Tier pools
    - Does not populate for Bronze Tier pools
### Water Features
- Admin Price Menu now includes a new column for 'Shipping' in the Water Features category
    - Fire Pots & Water/Fire Pots default to $350 in the Shipping column
- Fire Pit Valve Actuator (and Water/Fire pit) now charges 1 per quantity of Fire Bowls instead of per zone
-----
## [2.4.2] - 6/24/26
### Contract Update
- Line 73 now populates as "5 Year Warranty on Equipment" by default on Shotcrete pools
-----
## [2.4.1] - 6/14/26
### Tax Unification
- Adjusted all Tax values to a single exposed input in the Admin Pricing Menu (Misc)
    - Default 7.25%
-----
## [2.4.0] - 6/4/26
### Tiered Pricing
- Introduced a new pricing structure accomodating for different 'Pricing Tiers'
- 2 Pricing Tiers currently exist: Normal and Bronze
    - Bronze Pricing Tier can be edited in the Admin Pricing Menu
    - Default Bronze Pricing values are modeled from the Excel Workbook
    - Variables that differ from the Normal Tier will be highlighted in Red
    - A few options (like Microglass) are disabled for selection in the Bronze Tier
-----
## [2.3.13] - 6/4/26
### Warranty Defaults
- Travertine & Pavers now include a 1 Year Warranty. Concrete remains blank
### Category Notes
- Admins can now configure the descriptions of each subcategory for the proposal builder
- New "Edit Notes" button placed inside of the Admin Panel
---
## [2.3.12] - 5/26/26
### Heater Defaults
- Heater is now automatically added if a Spa is added to the Proposal
---
## [2.3.11] - 5/20/26
### Additional Pump Fix
- Fixed Additional Pump not appearing as a selection
- Fixed tooltip when adding an Additional Pump
- Blower now maps as "Blower" in the Warranty Breakdown
-----
## [2.3.10] - 5/15/26
### Gas Run Bug
- Changing an Equipment Package no longer clears the Gas Run input field
-----
## [2.3.9] - 5/10/26
### Admin Options
- Added Pool Bonding charge to Steel category
    - Configurable in Admin Panel (Default $500)
- Out of Ground Forming cost can be independantly edited in the Admin Pricing editor
-----
## [2.3.8] - 4/28/26
### PAP Discount Fix
- Removed accidental hardcoded PAP discounts from Pricing Engine math
### Book Keeper Tab
- Swapped visual style of Book Keeper to new UX format (in progress)
-----
## [2.3.7] - 4/22/26
### Fixes
- Items automatically added (like a Blower for a Spa) are now also removed if the (Spa) was removed
    - Does not apply if the item was manually added beforehand
- Custom Features line item in Customer Cost Breakdown no longer overfills with additional cents
- Selected Version in Proposal Summary now has a purple background to distinguish selection
- Proposal Versions column can be scrolled cleanly
---
## [2.3.6] - 4/21/26
### Hotfix
- Proposal discount UI was not applying as soon as the discount was entered
----
## [2.3.5] - 4/21/26
### Proposal Versions
- Completely overhauled Proposal Versions and the workflow associated with them
    - Proposal versions are now completely independant of each other and do not rely on an 'Active' state
        - No overlap with Contract, Breakdown, or COGS
    - Active & Inactive status states has been removed
    - When a Proposal is 'Submitted', the designer will be asked to choose which Draft version to Submit
    - When a Proposal is 'Signed', the designer will be asked to choose which Approved version to Sign
        - *Additional versions are archived after a version has been 'Signed'*
    - Proposal Versions can be renamed by right-clicking the version in the Nav column
-----
## [2.3.4] - 4/21/26
### Contracts
- Updated all 4 Contract templates to the new '2026' format
    - Wording, spacing, colors, & category names corrected
- Replaced 'Auxiliary Pump I/II' with 'Additional Pump I/II'
    - Blower no longer maps to the Auxiliary Pump line item
### Warranty Breakdown
- Editing the Warranty Breakdown fields no longer delete text while typing
    - This was caused from auto-saving, a 'Save Changes' button has been introduced
-----
## [2.3.2] - 4/20/26
### Hotfix
- Contract modifications made before the timestamp update should no longer overwrite stamped changes
- Losing internet before a contract sync has completed now pauses the sync until internet is restored
-----
## [2.3.1] - 4/17/26
### Hotfix
- Fix custom characters in PDF Export
-----
## [2.3.0] - 4/16/26
### Offline Functionality
- App can now be used while offline in most situations without interruption
- If the internet connection is interrupted while in the App:
    - Changes are saved locally and will sync to cloud when connection is restored
    - User cannot Submit or Sign proposals until connection is restored
- Online Required:
    - When first logging in
    - When Submitting/Signing a Proposal
    - Reviewer Actions (Approve/Ask for Changes)
    - Password/Profile changes
    - Admin Pricing Panel
-----
## [2.2.21] - 4/16/26
### Coping Adjustments
- 12x24 Coping no longer adds 100% of the 12x12 cost
    - Same cost as 12x12 coping
- 16x16 Coping still adds 33% to cost of material (compared to 12x12)
### Contract
- Name, Address, Phone Number, and other fields now populate between all pages if entered
-----
## [2.2.20] - 4/14/26
### Contract
- Auxillary Pump I now mapped to the 2nd Pump selection
- Waterline defaults to 'None' in fiberglass contracts
### Proposal Builder
- Microglass defaults to 'Off' instead of 'On'
-----
## [2.2.19] - 4/13/26
### IMPORTANT
- 'Mark as Signed' temporarily disabled while the Addendum Comparison UI is finalized for the Book Keeper
### Warranty Breakdown
- Old Warranty data (Jandy) no longer accidentally injects into the breakdown
    - Fields that were accidentally injected could not be edited, this has been resolved
    - Updated 5-Year and 3-Year Warranty logic
    - Plumbing Advantages cleaned up
### Fiberglass Pool Models
- Added a manual % discount column to the Fiberglass Pool Model table
### Book Keeper Tab
- Continuing to update the look of the Proposal View (still testing)
    - New tabs for COGS, Proposal Selections, Overview, and Notes
- *Comparing Proposal Addendums is temporarily disabled while under maintenance*
-----
## [2.2.17] - 4/9/26
### App Improvements
- Only 1 instance of the application can now be running at a time
    - Prevents issues with duplicate logins, update errors, and proposal syncing
-----
## [2.2.16] - 4/9/26
### Hotfix
- Proposal builder was not allowing the Sanitation and Autofill categories to be selected
-----
## [2.2.15] - 4/9/26
### Hotfix
- Price drifts while creating additional proposal versions solved
- Additional Decking no longer prevents autofilling the Decking SF in new versions of contracts
-----
## [2.2.13] - 4/9/26
### Fixed
- 'Bowls' in Contract mapped back to Wok Pots
- Rare situation where an incorrect price would flash before the correct total price
-----
## [2.2.11] - 4/8/26
### Tile/Coping/Decking Admin Pricing
- Redesigned subcategory to a Table style to add/remove new options
### Proposal Builder UI/UX
- Many sections felt distinctly different for the designer to select options. This unifies most of that
    - Aligned the Water Features section to the new selection UI
    - Aligned the Equipment section to the new selection UI
-----
## [2.2.10] - 4/8/26
### Fixed
- Tooltips should all render in the proper app style now
### Improvements
- COGS Breakdown can now be exported to PDF and Print
- Customer Cost & Warranty Breakdown now has a Print Preview
-----
## [2.2.9] - 4/6/26
### Fixed
- Legacy equipment data no longer fills into blank proposals
- Custom Equip Package now includes a Default Pool Light selection, configured in Admin Panel
-----
## [2.2.8] - 4/6/26
### Fiberglass Spa Plumbing
- Fiberglass Pool Shell with 'No Spa' selection no longer disables Spa logic
### Fixed
- Fixed old equipment data in equipment package selection and migrated proposals that were affected
-----
## [2.2.7] - 4/6/26
### Fiberglass Spa Plumbing
- Fixed the bug causing Fiberglass Spas to not bill Spa Base and Plubming Overruns like Shotcrete does
### Proposal Summary Screen
- Changed the UI of the Proposal Summary to a 3-Column layout
    - Proposal Version Navigation in the left column
    - Proposal Summary in the middle column
    - Proposal Actions & Activity in the right column
*This change will hopefully make the Summary section easier to navigate*
-----
## [2.2.6] - 4/6/26
### Fixed
- Chosen Water Features now populate in the correct areas to display their cost
    - Previously were appearing in the Equipment Set instead of Water Features
-----
## [2.2.5] - 4/3/26
### Changed
- Proposals Contracts can now be edited until the Proposal is marked as 'Signed'
    - If another edit to the Contract needs to be made after 'Signed', a Proposal Addendum must be made
- Exporting a Contract now gives a propoer Print Preview and *should* print correctly
-----
## [2.2.3] - 4/3/26
### HOTFIX
- Fixed unknown draft state issue with Admins
-----
## [2.2.2] - 4/2/26
### Changed
- 'Retired Equipment' workflow has been modified to be more clear
    - All Proposals that have selected a certain piece equipment; if that equipment was modified or removed in the Admin Pricing Model, the equipment will be marked as 'Removed' for the user
    - Clear indication that the user must select another option; cannot mark as 'Signed' until the change is made
        - Does NOT impact 'Signed' Proposals or 'Completed' Proposals; only 'Draft' and 'Submitted'
### Fixed
- Inactive Price Models used in Proposals now display their intended 'Inactive' notifier
- Proposals that were submitted before the Submission Workflow Change are no longer in limbo
-----
## [2.2.1] - 4/2/26
### Proposal Submission Workflow Changes
- Toggle for 'Require Approval' added per user in the Admin Panel
    - If this option is off, Proposals are automatically approved
- Toggle for 'Mark as Signed'
    - Marking a Proposal version as 'Signed' removes previous non-active versions
    - Additional modifications can be made to the signed proposal and reflect as a Proposal Addendum
    - All users can see the comparison breakdown of Proposal Addendums
### Changed
- 'Show COGS' option now lives in the Proposal Summary screen to toggle On/Off from view
    - Designers can now see this option
- Hidden Proposal Gross Profit % now appears in the Customer Job Cost Breakdown
    - Visual only, will not export along with the breakdown
### Improvements
    - Fiberglass Contracts should format correctly now
    - Numerous backend code changes should allow for faster loading and rendering
    - Removed lots of old, unreferenced data
-----
## [2.2.0] - 4/1/26
### Proposal Submission Workflow
    - Submitting a Proposal now locks the Submited Proposal from edits, and can then be viewed by an Admin or Book Keeper for Approval
    - All Proposals are saved in a 'Draft' until they are manually Submitted
        - Additional versions of the Submitted Proposal can still be created and replace the current submission
        - Designers can still create multiple versions before submitting their intended version
    - A Sumbitted Proposal can be 'Approved' or 'Returned with Notes' by an Admin / Book Keeper
        - If a Proposal is 'Approved': Any changes made by the designer afterwards are separated into a new version; Proposal Addendum
            - A Proposal Addendum allows the Admin / Book Keeper to quickly see changes made to the originally Approved Proposal
            - Proposal Addendum must also be Approved after it is submitted
        - If a Proposal is 'Returned with Notes': Designers can resubmit a new version after changes are made
    - Approved Proposals (and Proposal Addendums) still need to be marked as 'Completed' by an Admin or Book Keeper
        - Completed Proposals cannot be modified after marking as 'Complete'. This should be done after the build
        - Completed Proposals are reconsiled in the Archive of the Book Keeper tab
### New 'Book Keeper' Role
    - Book Keeper Role can be assigned by an Admin or Owner in the Admin Tab
    - Book Keeper Tab gives a quick comparison view of Proposal differences
    - Book Keeper Role has the ability to review and process Submitted Proposals
        - *This section will continue to be improved*
### Fiberglass Introduction
    - Fiberglass Pool Models, Spa Models, and Tanning Ledges introduced into the engine
        - Options can be configured by the Admin
    - Contract correctly updates with Deposit breakdown and Fiberglass selection
    - Important Excel Notes:
        - Plumbing cost was always reduced to 40% of the normal subtotal cost
        - Steel cost is forced to 0
        - Shotcrete cost is forced to 0
        - Tile cost is forced to 0
        - Interior Finish cost is forced to 0
        - Coping adds Concrete Band Cost (Fiber pool count * perimeter * 1.25)
        - Spillover cost always adds $1000 (configured by admin)
            - Spillover 'Yes' also adds an increased cost depending on the selected shell
            - ^^^ Essentially 2 cost increases for Spillover
-----
## [2.1.3] - 4/1/26
### Improvements
- Feedback Button Tutorial (1st time only)
-----
## [2.1.1] - 3/31/26
### Security Changes
- Only 1 logged in session per user can be active at a time
    - Will prompt to sign other session out if 2 active logins are detected
- Moved Admin-only settings into the Admin Tab in the new 'Admin Settings' area
    - Change App Name, Franchise Code, Admin PIN, & Hide COGS view
- Active ledger logs milestone events per franchise (server side)
    - Logs User, Role, Time, and Action conducted
        - Action examples: Creating a new user, deleting a user, promoting a user to admin, etc
### Improvements
- User Profile Section
    - Clicking the 'Profile Settings' option from the User Block (Your Name) opens a new Profile section
    - Edit Name, Email, and Reset Password
- Feedback Button
    - Leave feedback for improvements, issues, and feature requests all within the app
    - Feedback Button is located persistently in the bottom right corner of the app
- Proposal Table UI
    - Removed the Proposal Tab and replaced it with the Dashboard Proposal Table
    - Filter Customer Name, Status, Pricing Mode, and Contract Type
    - Ability to 'Hide Table' from view
### Requested Changes
- Warranty Breakdown
    - Polished the look of the PDF when exporting & printing
    - Included all changes and logic requested for the updated breakdown
- Contract
    - New 'Additional Features' mapped to the Contracts
        - *Only Bubblers autofill currently*
- Customer Job Cost Summary
    - Decking no longer appears in this summary if "Off Contract" is active
-----
## [2.0.18] - 3/31/26
## Changes
- App Name now updates to the Franchise name
- Designer 'Customer Cost Breakdown' button aligned with Admins' button
-----
## [2.0.17] - 3/31/26
## Fixes
- Exporting Contract & Warranty PDF fixed
-----
## [2.0.16] - 3/31/26
- Warranty Customization
    - Added ability to customize the Warranty section of the Job Cost Summary
    - Left click a category or line item to edit the field
    - Right click a category or line item to Add / Remove items to the category
- Exporting Options
    - Job Cost Summary & Warranty export logic now matches the Contract export logic
-----
## [2.0.15] - 3/31/26
-  Aligned Additional Decking with intended use case
    - Ability to add multiple decking options
    - Changed Concrete Waste overhead to 0%
-----
## [2.0.14] - 3/31/26
- Additional Decking Options
    - Ability to add Additional Decking options
    - Independant 'Off Contract' & 'Remove Waste' logic
    - Custom SQFT input field for selected option
- Freeform or Geometric Pool
    - Option to select if pool is Freeform or Geometric
        - Freeform: Adds 5% overhead to the Decking category (Not for Concrete selection)
        - Bills as line item 'Freeform Decking Overhead'
- Grouped Custom Pricing
    - Sod and Fencing included as Subcategories in Grouped Pricing
    - Configurable with Set Price or Price Per SQFT
        - Ability to include extra costs (Gates) per Subcategory
-----
## [2.0.13] - 3/30/26
- Master Tab Update
- Commission Amount adjustable per user
    - Admins can configure default Commission Amount
-----
## [2.0.12]
- Off Contract Decking
    - Takes original decking cost and moves it straight to Total Retail, no increase
    - Marks the Decking as 'Off Contract' in the COGS and Contract
    - Includes itself in the Off Contract Addendum
-----
## [2.0.10]
- Auxillary Pump logic with Spa
    - Automatically adds Aux Pump with spa (default set by admin)
    - Populates in 'Blower' input of contract (page 2)
        - Auxillary Pumps not added by a spa populate in 'Auxillary Pump II'
- Proposal Summary
    - Chosen Equipment Package now displays in the summary
    - Pump no longer populates with Auxillary Pump
- Contract Exporting
    - Recent changes are saved after clicking 'Export'
        - No need to 'Save' before clicking Export anymore
- Admin Pricing Menu Redesign
    - Redesigned the UI of the Admin Pricing Model
-----
## [2.0.9]
- Spa Perimeter Autofill
    - Contract now properly autofills the Spa Perimeter
- Rough Grading
    - Option to enable or disable Rough Grading while Decking is 'Off-Contract"
- Contract Payment Schedule
    - Math for Deposit Amount fixed to reflect correct logic
-----
## [2.0.6]
- Swapped Backside Facing from Exposed Pool Wall to RBB
- Fixed Edit Proposal crash
- Parched Concrete changed to Parged Concrete
- 5 Year Warranty cost inclusion
- Contract Autofill
    - Surface Returns
    - Decking SQFT
    - Downspout SQFT
    - Coping Size
    - Custom Features
-----
## [2.0.5]
- Valve Actuator toggle per Water Feature zone
    - Included a checkbox next to each added water feature to turn off the Valve Actuator cost
- Wok Pot logic cleanup
    - Water & Fire and Fire Wok Pots now ask for a gas run with the Water Feature run
- Laminier Jet logic
    - Laminier Jet requires conduit run
    - Admin can select which Jets need conduit
- Water Feature pipe size
    - Aligned all Water Features and additionals use 2" pipe
- Deposit Breakdown in Contract
    - Properly autofills the payment schedule when a deposit amount is entered
- Custom Features Off-Contract & Grouped Features
    - Custom Features can now be marked Off-Contract
    - Grouped Custom Features can be created by an admin (sod, fencing)
-----
## [2.0.4]
- Zoom Toggle on contract preview
    - Can zoom the contract in and out while previewing
- Price Model in proposal builder
    - Adjusted size and look of price model dropdown in the top of the builder
- Admin setting to 'Hide' COGS in Proposal Builder
    - Admins can now toggle On/Off the ability to view the COGS breakdown while building a proposal
        - This includes the COGS button in the Prop builder and the COGS block in the summary screen
- Changelog
    - Admins and Owners are now greeted with the Changelog if the app was updated
-----
## [2.0.3]
- Equipment Package Options
    - Added the ability to create Equipment Packages
    - Can be customized in the admin menu
    - Aligned initial package options
-----
## [2.0.2]
- Plumbing Cost Update
    - Aligned with new prices and exposed options to edit in the Admin Panel
- Exposed Pool Wall (Out of Ground Forming)
    - Added Exposed Pool Wall subcategory to Excavation
    - Same input options as selecting RBB
    - Only the RBB Forming cost bills for the Exposed Pool Wall, in addition to Strip Forms cost per LNFT
        - *Does not include base Strip Form Cost*
    - Added Backside Facing toggle (doubles the facing cost)
        - Added Parched Concrete facing option
- Pool Bonding billed to Excavation category in COGS
    - Pool bonding now bills as LNFT perimeter of pool @ $2ft, 10% overhead. Editable
    - *Pool Bonding used to bill $500 in Steel & $125 in Equipment Set*
- Blower Equipment Subcategory in Proposal Builder
    - Added "Auxillary Pump" to equipment section, defaults with Spa. Fixed additional main drain
- Default Pool Lights
    - Pool Lights now default to 2 Pool Lights, Spa defaults to 1 Spa Light
    - Can edit which lights are default in Admin Panel
- HydraPure Sanitation additional add-on
    - Added an "Additional Options" dropdown to include add-ons
    - Can be configured in the Admin Panel
- LED Bubbler & Conduit Run, Pool Light cost
    - Pool Lights will now bill with specific Bubblers, set in Admin Panel
        - Designer will see a UI prompt notifying them a Light has been included
    - Conduit Run now appears as an input - same value as WF run - and bills the Plumbing Conduit cost
- Valve Actuator per Water Feature Zone
    - Valve Actuator Cost is now an input in the Admin Panel (Misc. Plum)
    - 1 Valve Actuator is billed per unique category of Water Features
        - Ex: 2 Wok Pots bills with 1 Valve Actuator. 1 Wok Pot & 1 Jet bills with 2 Valve Actuators
- Auto-Fill Electric Runs
    - Admin can edit which Auto-Fill systems require an Electric Run
    - Electric Run is mirrored to the Auto-Fill Run value, and bills as an electric run
- Travertine Level 3 - Decking
    - Added Travertine Level 3 decking option
    - *Admin will be able to add / remove levels in a future update*
- Default Cleaner
    - Admin can select a default Cleaner option (Polaris 7240)
- Automation and Sanitation System logic
    - Admin can select which Automation Systems include a "Salt Cell"
        - When a designer selects one of these Automation Systems, the Sanitation Systems update to only display Additional Options
    - If an Automation System is selected that does not include a Salt Cell, All Sanitation System options remain
    - HydraPure UV locatated in Additional Options of Sanitation System
- Off-Contract Custom Option
    - Added ability to input "Off-Contract" costs inside each Custom Options category
        - Off Contract items are NOT billed to COGS and do NOT appear inside of the COGS breakdown or Contract
        - Off Contract items are broken down in a separate block (temporary) in the Proposal Summary screen
        - Off Contract items are billed directly to the Retail Cost (without increase) so margin is unaffected
    - Added specific Off-Contract toggle for the Decking category
        - Removes any costs associated with Decking and routes the Off Contract Decking Cost input directly to the Retail Cost
        - Does not appear as a line item in COGS, appears in separate block in the Proposal Summary Screen
        - Contract autocomplete for decking fills as "OFF CONTRACT"
- Strip Forms RBB Additional Cost
    - Strip Forms now bill additional $2.5 per LNFT of RBB
    - Admin can edit price in Misc. Plumbing of Admin Panel
    - *Used to bill flat $700*
- Retail Increase % adjustment option
    - Added input field to adjust retail price % increase in the Admin Panel
        - COGS vs Retail Price Increase
-----
## [2.0.0]
- Admin Price Menu Update
    - Every input has a label and tooltip describing what the input does
        - If an input appears in a Red background, it is not currently used
    - Ability to rename Additional Cost Columns for clarity
- Save Draft button
    - Save Draft now appears in the proposal builder
        - Takes desginer directly to summary screen in a 'Draft' state
- Price Model location
    - Moved Price Model selection to the top of the proposal builder, persistent
-  Facing Options for RBB and Exposed Pool Wall
    - Can now add/remove facing options for RBB and EPW
    - Material Costs and labor can be changed in the same table
