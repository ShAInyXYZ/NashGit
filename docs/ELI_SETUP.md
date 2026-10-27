# NashGit setup for a separate NAS account

This public template uses example addresses and account names. Obtain your actual address, username, and initial password from your administrator through a private channel.

Your NashGit backs up Git projects to your own NAS storage. It has a separate login and repository list from the main instance.

- **Address:** https://your-nas.example:9444
- **Username:** `your-username`
- **Initial password:** open `NashGit-Login.txt` in your your assigned network share. This is a separate password from your NAS login.
- **Backup location:** `your-share/NashGit` on the NAS. Let NashGit manage that folder; do not edit its contents directly.

## 1. Connect and sign in

Connect Tailscale on your computer using the NAS access your administrator has shared with you. Open the address above, sign in, and change your initial password in **Settings**. Save the new password in your password manager, then remove the initial-password file.

If the address does not open, check that Tailscale is connected. Your administrator may need to allow your device access to the NAS on port **9444**.

## 2. Prepare your computer

Install Git if needed. On Windows, use Git Bash for the commands below; on macOS or Linux, use Terminal. Confirm that `git --version` works. No Node.js installation is needed for this guide.

In NashGit, create a repository named `my-project`. Open **Tokens**, create a token named after your computer, and save it in your password manager. The token is shown only once.

## 3. Back up an existing Git project

Open a terminal inside your project folder. Commit the changes you want to back up, then run:

```bash
git remote add nas https://your-nas.example:9444/git/my-project.git
git push nas --all
git push nas --tags
```

Replace `my-project` with the repository name you created. When Git asks for credentials, use `your-username` as the username and your **deploy token** as the password, not your website or NAS password. A configured credential manager may remember it.

If Git says the remote `nas` already exists, run `git remote get-url nas` and check its destination before changing it.

For later backups, commit your work and repeat the two `git push` commands. These commands upload all local branches and tags. Backups are manual unless you separately configure a schedule.

## 4. Get a project onto another computer

Connect Tailscale, then run:

```bash
git clone https://your-nas.example:9444/git/my-project.git
```

Use your token when prompted. For an existing clone, `git pull nas main` pulls the `main` branch from a remote called `nas`; a fresh clone uses `origin` instead. Substitute your actual branch name.

## What gets backed up

Git commits and the branches and tags you push are stored on the NAS. Unsaved edits, uncommitted changes, ignored files, and separate Git LFS objects are not covered by these commands. NashGit rejects force pushes and branch deletion to protect backup history.

After your first push, check the repository in the website and use **Verify** to check its Git data. A fresh clone is a useful restore check.
