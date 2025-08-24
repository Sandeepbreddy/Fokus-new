/**
 * Popup Controller
 * Handles all popup interactions
 */

document.addEventListener('DOMContentLoaded', function ()
{
    console.log('Popup loaded');

    // Initialize the popup
    init();
});

function init()
{
    // Hide loading screen and show auth screen
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

    // For testing, just show the main screen
    showMainScreen();
}

async function handleSignUp(e)
{
    e.preventDefault();

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    // Show loading state
    const submitBtn = document.getElementById('signup-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Account...';

    try
    {
        // For testing, show email confirmation screen
        document.getElementById('confirmation-email').textContent = email;
        showForm('confirmation');

        // In production, this would call the actual signup API
        // const result = await chrome.runtime.sendMessage({
        //     type: 'AUTH_SIGN_UP',
        //     payload: { email, password }
        // });
    } catch (error)
    {
        document.getElementById('signup-error').textContent = 'Signup failed. Please try again.';
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
        // For testing, show confirmation message
        document.getElementById('confirmation-email').textContent = email;

        // Change the confirmation message for password reset
        const confirmationEl = document.getElementById('email-confirmation');
        confirmationEl.querySelector('h2').textContent = 'Check Your Email';
        confirmationEl.querySelector('.confirmation-info').textContent =
            'We\'ve sent a password reset link to your email. Please check your inbox and follow the instructions.';

        // Hide the checking status for password reset
        confirmationEl.querySelector('.checking-status').style.display = 'none';

        showForm('confirmation');

        // In production, this would call the actual reset API
        // const result = await chrome.runtime.sendMessage({
        //     type: 'AUTH_RESET_PASSWORD',
        //     payload: { email }
        // });
    } catch (error)
    {
        // Show error message
        alert('Failed to send reset email. Please try again.');
    } finally
    {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
    }
}

async function handleResendEmail(e)
{
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    // Simulate sending email
    setTimeout(() =>
    {
        btn.textContent = 'Email Sent!';
        setTimeout(() =>
        {
            btn.disabled = false;
            btn.textContent = 'Resend Email';
        }, 2000);
    }, 1000);
}

function showMainScreen()
{
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');

    // Set up main screen event listeners
    setupMainScreenListeners();
}

function setupMainScreenListeners()
{
    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn)
    {
        settingsBtn.addEventListener('click', () =>
        {
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('settings-screen').classList.add('active');
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
        signoutBtn.addEventListener('click', () =>
        {
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('active');
        });
    }
}