# QBO Script Tracker

A simple, elegant web application to track customer calls for QuickBooks Online bank connection script development.

## 📋 Features

- **Track 3 Types of Customer Calls:**
  1. **HAR/HTML Collection** - Initial data gathering from customers
  2. **Verification Attempt** - Testing if script works and customer can connect to QBO
  3. **Issue Check** - Troubleshooting error codes and connection issues

- **Dashboard Overview** - Quick stats on pending, in-progress, completed, and error entries

- **Bank Tracking** - See all banks at a glance with their connection status

- **Search & Filter** - Find entries by bank name, customer ID, or notes

- **Export/Import** - Share data with teammates via JSON export/import

- **Local Storage** - Data persists in your browser (no backend needed)

## 🚀 Deploying to GitHub Pages

### Option 1: Deploy as part of your portfolio

1. Ensure the `qbo-tracker` folder is inside your portfolio repository
2. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Add QBO Script Tracker application"
   git push origin main
   ```
3. Enable GitHub Pages in your repository settings:
   - Go to **Settings** → **Pages**
   - Under "Source", select **Deploy from a branch**
   - Select **main** branch and **/ (root)** folder
   - Click **Save**

4. Access your tracker at: `https://yourusername.github.io/yourrepo/qbo-tracker/`

### Option 2: Deploy as a standalone repository

1. Create a new repository on GitHub (e.g., `qbo-tracker`)
2. Initialize and push:
   ```bash
   cd qbo-tracker
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/qbo-tracker.git
   git push -u origin main
   ```
3. Enable GitHub Pages (same steps as above)
4. Access at: `https://yourusername.github.io/qbo-tracker/`

## 📱 Usage

### Adding a New Entry
1. Click the **"Add Entry"** button
2. Fill in:
   - **Bank Name** - e.g., Chase, Bank of America
   - **Customer/Case ID** - Your internal reference
   - **Call Type** - Select the purpose of the call
   - **Status** - Current state of the entry
   - **Connection Status** - Whether QBO connection was successful
   - **Error Code** - Any error codes encountered
   - **Notes** - Additional details
3. Click **Save Entry**

### Sharing Data with Teammates
Since this app uses browser localStorage, each person's data is separate. To share:

1. **Export**: Click "Export Data" to download a JSON file
2. **Share**: Send the JSON file to your teammate
3. **Import**: They click "Import Data" and select the file

> **Note**: Importing merges new entries with existing ones (no duplicates by ID)

## 🔧 Technical Details

- **Pure HTML/CSS/JS** - No frameworks or build steps needed
- **Responsive Design** - Works on desktop and mobile
- **Dark Theme** - Easy on the eyes during long tracking sessions
- **No Backend** - Everything runs in the browser

## 📊 Workflow Example

1. **Day 1**: Customer call scheduled for HAR/HTML collection
   - Add entry with Call Type: "HAR/HTML Collection", Status: "Pending"
   - After call, update Status to "Completed"

2. **Day 3**: Script development complete, need verification
   - Add new entry with Call Type: "Verification Attempt"
   - After customer test, update Connection Status

3. **Day 5**: Customer reports error code
   - Add entry with Call Type: "Issue Check"
   - Record error code in the Error Code field
   - Track resolution in Notes

## 🎨 Customization

Feel free to modify `styles.css` to match your team's branding or preferences!

---

Built for efficient tracking of QuickBooks Online bank connection scripts.

