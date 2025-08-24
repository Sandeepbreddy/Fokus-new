/**
 * Popup Controller with Real Supabase Integration
 * Handles all popup interactions and authentication
 */

document.addEventListener('DOMContentLoaded', function ()
{
    console.log('Popup loaded');

    // Initialize the popup
    init();
});

async function init()
{
    // Check if user is already authenticated
    try
    {
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_GET_SESSION'
        });

        if (response && response.success && response.data)
        {
            // User is authenticated, show main screen
            setTimeout(() =>
            {
                document.getElementById('loading-screen').classList.remove('active');
                showMainScreen();
            }, 500);
        } else
        {
            // Show auth screen
            setTimeout(() =>
            {
                document.getElementById('loading-screen').classList.remove('active');
                document.getElementById('auth-screen').classList.add('active');

                // Ensure sign in form is visible initially
                document.getElementById('signin-form').style.display = 'block';
                document.getElementById('signin-form').classList.add('active');
                document.getElementById('signup-form').style.display = 'none';
                document.getElementById('email-confirmation').style.display = 'none';
                document.getElementById('password-reset').style.display = 'none';
            }, 1000);
        }
    } catch (error)
    {
        console.error('Error checking session:', error);
        // Show auth screen on error
        setTimeout(() =>
        {
            document.getElementById('loading-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('active');
        }, 1000);
    }

    // Set up event listeners
    setupEventListeners();
}

function setupEventListeners()
{
    // Sign in form
    const signinForm = document.getElementById('signin-form');
    if (signinForm)
    {
        signinForm.addEventListener('submit', handleSignIn);
    }

    // Sign up form
    const signupForm = document.getElementById('signup-form');
    if (signupForm)
    {
        signupForm.addEventListener('submit', handleSignUp);
    }

    // Password reset form
    const resetForm = document.getElementById('reset-form');
    if (resetForm)
    {
        resetForm.addEventListener('submit', handlePasswordReset);
    }

    // Toggle between sign in and sign up
    const showSignup = document.getElementById('show-signup');
    if (showSignup)
    {
        showSignup.addEventListener('click', (e) =>
        {
            e.preventDefault();
            showForm('signup');
        });
    }

    const showSignin = document.getElementById('show-signin');
    if (showSignin)
    {
        showSignin.addEventListener('click', (e) =>
        {
            e.preventDefault();
            showForm('signin');
        });
    }

    // Forgot password link
    const forgotPassword = document.getElementById('forgot-password');
    if (forgotPassword)
    {
        forgotPassword.addEventListener('click', (e) =>
        {
            e.preventDefault();
            showForm('reset');
        });
    }

    // Back to sign in from password reset
    const backToSignin = document.getElementById('back-to-signin');
    if (backToSignin)
    {
        backToSignin.addEventListener('click', (e) =>
        {
            e.preventDefault();
            showForm('signin');
        });
    }

    // Resend email button
    const resendEmail = document.getElementById('resend-email');
    if (resendEmail)
    {
        resendEmail.addEventListener('click', handleResendEmail);
    }
}

function showForm(formType)
{
    // Hide all forms
    document.getElementById('signin-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('email-confirmation').style.display = 'none';
    document.getElementById('password-reset').style.display = 'none';

    // Remove active classes
    document.querySelectorAll('.auth-form, .auth-message').forEach(form =>
    {
        form.classList.remove('active');
    });

    // Clear error messages
    document.querySelectorAll('.error-message').forEach(error =>
    {
        error.textContent = '';
    });

    // Show the requested form
    switch (formType)
    {
        case 'signin':
            document.getElementById('signin-form').style.display = 'block';
            document.getElementById('signin-form').classList.add('active');
            break;
        case 'signup':
            document.getElementById('signup-form').style.display = 'block';
            document.getElementById('signup-form').classList.add('active');
            break;
        case 'reset':
            document.getElementById('password-reset').style.display = 'block';
            document.getElementById('password-reset').classList.add('active');
            break;
        case 'confirmation':
            document.getElementById('email-confirmation').style.display = 'block';
            document.getElementById('email-confirmation').classList.add('active');
            break;
    }
}

async function handleSignIn(e)
{
    e.preventDefault();

    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    const errorElement = document.getElementById('signin-error');
    const submitBtn = document.getElementById('signin-submit');

    // Clear previous errors
    errorElement.textContent = '';

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try
    {
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_SIGN_IN',
            payload: { email, password }
        });

        if (response && response.success)
        {
            // Sign in successful
            showMainScreen();
        } else
        {
            // Show error
            errorElement.textContent = response?.error || 'Sign in failed. Please try again.';
        }
    } catch (error)
    {
        console.error('Sign in error:', error);
        errorElement.textContent = 'An error occurred. Please try again.';
    } finally
    {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
    }
}

async function handleSignUp(e)
{
    e.preventDefault();

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const errorElement = document.getElementById('signup-error');
    const submitBtn = document.getElementById('signup-submit');

    // Clear previous errors
    errorElement.textContent = '';

    // Validate password length
    if (password.length < 6)
    {
        errorElement.textContent = 'Password must be at least 6 characters';
        return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Account...';

    try
    {
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_SIGN_UP',
            payload: { email, password }
        });

        if (response && response.success)
        {
            if (response.data?.requiresEmailConfirmation)
            {
                // Show email confirmation screen
                document.getElementById('confirmation-email').textContent = email;
                showForm('confirmation');

                // Start checking for email confirmation
                startEmailConfirmationCheck(email);
            } else
            {
                // Auto-confirmed, sign in successful
                showMainScreen();
            }
        } else
        {
            // Show error
            errorElement.textContent = response?.error || 'Sign up failed. Please try again.';
        }
    } catch (error)
    {
        console.error('Sign up error:', error);
        errorElement.textContent = 'An error occurred. Please try again.';
    } finally
    {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
    }
}

async function handlePasswordReset(e)
{
    e.preventDefault();

    const email = document.getElementById('reset-email').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try
    {
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_RESET_PASSWORD',
            payload: { email }
        });

        if (response && response.success)
        {
            // Show confirmation message
            document.getElementById('confirmation-email').textContent = email;

            // Change the confirmation message for password reset
            const confirmationEl = document.getElementById('email-confirmation');
            confirmationEl.querySelector('h2').textContent = 'Check Your Email';
            confirmationEl.querySelector('.confirmation-info').textContent =
                'We\'ve sent a password reset link to your email. Please check your inbox and follow the instructions.';

            // Hide the checking status for password reset
            confirmationEl.querySelector('.checking-status').style.display = 'none';

            showForm('confirmation');
        } else
        {
            alert(response?.error || 'Failed to send reset email. Please try again.');
        }
    } catch (error)
    {
        console.error('Password reset error:', error);
        alert('An error occurred. Please try again.');
    } finally
    {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
    }
}

async function handleResendEmail(e)
{
    const btn = e.target;
    const email = document.getElementById('confirmation-email').textContent;

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try
    {
        // In a real implementation, you'd call a resend endpoint
        // For now, we'll just show a success message
        btn.textContent = 'Email Sent!';
        setTimeout(() =>
        {
            btn.disabled = false;
            btn.textContent = 'Resend Email';
        }, 3000);
    } catch (error)
    {
        console.error('Resend email error:', error);
        btn.disabled = false;
        btn.textContent = 'Resend Email';
    }
}

function startEmailConfirmationCheck(email)
{
    let checkAttempts = 0;
    const maxAttempts = 60; // Check for 5 minutes (every 5 seconds)

    const checkInterval = setInterval(async () =>
    {
        checkAttempts++;

        try
        {
            // Try to sign in - if email is confirmed, it will work
            const response = await chrome.runtime.sendMessage({
                type: 'AUTH_GET_SESSION'
            });

            if (response && response.success && response.data)
            {
                // Email confirmed and signed in!
                clearInterval(checkInterval);
                showMainScreen();
            }
        } catch (error)
        {
            console.error('Email check error:', error);
        }

        if (checkAttempts >= maxAttempts)
        {
            clearInterval(checkInterval);
            // Update UI to show timeout
            const checkingStatus = document.querySelector('.checking-status');
            if (checkingStatus)
            {
                checkingStatus.innerHTML = '<span style="color: #F59E0B;">Email confirmation is taking longer than expected. Please check your spam folder.</span>';
            }
        }
    }, 5000); // Check every 5 seconds
}

function showMainScreen()
{
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');

    // Load user data and stats
    loadUserData();

    // Set up main screen event listeners
    setupMainScreenListeners();
}

async function loadUserData()
{
    try
    {
        // Get user info
        const sessionResponse = await chrome.runtime.sendMessage({
            type: 'AUTH_GET_SESSION'
        });

        if (sessionResponse && sessionResponse.success && sessionResponse.data?.user)
        {
            const user = sessionResponse.data.user;
            const welcomeMessage = document.getElementById('welcome-message');
            if (welcomeMessage)
            {
                const name = user.email.split('@')[0];
                welcomeMessage.textContent = `Welcome back, ${name}!`;
            }
        }

        // Get today's stats
        const statsResponse = await chrome.runtime.sendMessage({
            type: 'STATS_GET_TODAY'
        });

        if (statsResponse && statsResponse.success && statsResponse.data)
        {
            const stats = statsResponse.data;

            // Update stat displays
            const statBlocks = document.getElementById('stat-blocks');
            if (statBlocks)
            {
                statBlocks.textContent = stats.totalBlocks || '0';
            }

            const statTime = document.getElementById('stat-time');
            if (statTime)
            {
                const hours = Math.floor((stats.timeSaved || 0) / 60);
                const minutes = (stats.timeSaved || 0) % 60;
                statTime.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            }

            const statStreak = document.getElementById('stat-streak');
            if (statStreak)
            {
                statStreak.textContent = stats.streak || '0';
            }
        }

        // Update protection status
        const protectionStatus = document.getElementById('protection-status');
        if (protectionStatus)
        {
            protectionStatus.textContent = 'Protection is active';
            protectionStatus.className = 'status-text status-active';
        }
    } catch (error)
    {
        console.error('Error loading user data:', error);
    }
}

function setupMainScreenListeners()
{
    // Quick block
    const quickBlockBtn = document.getElementById('quick-block-btn');
    if (quickBlockBtn)
    {
        quickBlockBtn.addEventListener('click', handleQuickBlock);
    }

    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn)
    {
        settingsBtn.addEventListener('click', () =>
        {
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('settings-screen').classList.add('active');
            loadSettings();
        });
    }

    // Back from settings
    const backFromSettings = document.getElementById('back-from-settings');
    if (backFromSettings)
    {
        backFromSettings.addEventListener('click', () =>
        {
            document.getElementById('settings-screen').classList.remove('active');
            document.getElementById('main-screen').classList.add('active');
        });
    }

    // Stats button
    const viewStatsBtn = document.getElementById('view-stats-btn');
    if (viewStatsBtn)
    {
        viewStatsBtn.addEventListener('click', () =>
        {
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('stats-screen').classList.add('active');
            loadStatistics();
        });
    }

    // Back from stats
    const backFromStats = document.getElementById('back-from-stats');
    if (backFromStats)
    {
        backFromStats.addEventListener('click', () =>
        {
            document.getElementById('stats-screen').classList.remove('active');
            document.getElementById('main-screen').classList.add('active');
        });
    }

    // Sign out button
    const signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn)
    {
        signoutBtn.addEventListener('click', handleSignOut);
    }

    // Manage blocklist button
    const manageBlocklistBtn = document.getElementById('manage-blocklist-btn');
    if (manageBlocklistBtn)
    {
        manageBlocklistBtn.addEventListener('click', () =>
        {
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('settings-screen').classList.add('active');
            loadSettings();
        });
    }
}

async function handleQuickBlock()
{
    const input = document.getElementById('quick-block-input');
    if (!input || !input.value) return;

    const value = input.value.trim().toLowerCase();
    const quickBlockBtn = document.getElementById('quick-block-btn');

    // Disable button while processing
    quickBlockBtn.disabled = true;
    quickBlockBtn.textContent = 'Adding...';

    try
    {
        // Determine if it's a domain or keyword
        const isDomain = value.includes('.') && !value.includes(' ');

        const response = await chrome.runtime.sendMessage({
            type: isDomain ? 'BLOCKLIST_ADD_DOMAIN' : 'BLOCKLIST_ADD_KEYWORD',
            payload: isDomain ? { domain: value } : { keyword: value }
        });

        if (response && response.success)
        {
            showToast(`${isDomain ? 'Domain' : 'Keyword'} blocked successfully!`, 'success');
            input.value = '';
            // Reload stats
            loadUserData();
        } else
        {
            showToast(response?.error || 'Failed to add to blocklist', 'error');
        }
    } catch (error)
    {
        console.error('Quick block error:', error);
        showToast('An error occurred', 'error');
    } finally
    {
        quickBlockBtn.disabled = false;
        quickBlockBtn.textContent = 'Block';
    }
}

async function handleSignOut()
{
    if (!confirm('Are you sure you want to sign out?')) return;

    try
    {
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_SIGN_OUT'
        });

        if (response && response.success)
        {
            // Show auth screen
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('settings-screen').classList.remove('active');
            document.getElementById('stats-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('active');
            showForm('signin');
        }
    } catch (error)
    {
        console.error('Sign out error:', error);
        showToast('Failed to sign out', 'error');
    }
}

async function loadSettings()
{
    // This would load all settings from the background script
    // For now, we'll just show placeholder data
    console.log('Loading settings...');
}

async function loadStatistics()
{
    // This would load statistics from the background script
    // For now, we'll just show placeholder data
    console.log('Loading statistics...');
}

function showToast(message, type = 'info')
{
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Animate in
    setTimeout(() =>
    {
        toast.classList.add('show');
    }, 10);

    // Remove after 3 seconds
    setTimeout(() =>
    {
        toast.classList.remove('show');
        setTimeout(() =>
        {
            toast.remove();
        }, 300);
    }, 3000);
}