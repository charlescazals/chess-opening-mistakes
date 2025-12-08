// Utility functions for the Chess Mistakes Analyzer

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}

function formatTimeControl(timeControl) {
    if (!timeControl) return '';
    // Parse formats like "300+5" or "180" or "600"
    const parts = timeControl.split('+');
    const baseSeconds = parseInt(parts[0]) || 0;
    const minutes = Math.floor(baseSeconds / 60);
    const increment = parts[1] ? parseInt(parts[1]) : 0;

    if (increment > 0) {
        return `${minutes}|${increment}`;
    }
    return `${minutes} min`;
}

function formatDate(unixTimestamp) {
    if (!unixTimestamp) return '';
    const date = new Date(unixTimestamp * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function getTimeIcon(timeClass) {
    if (timeClass === 'blitz') {
        return `<svg class="blitz-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5.77002 15C4.74002 15 4.40002 14.6 4.57002 13.6L6.10002 3.4C6.27002 2.4 6.73002 2 7.77002 2H13.57C14.6 2 14.9 2.4 14.64 3.37L11.41 15H5.77002ZM18.83 9C19.86 9 20.03 9.33 19.4 10.13L9.73002 22.86C8.50002 24.49 8.13002 24.33 8.46002 22.29L10.66 8.99L18.83 9Z"></path></svg>`;
    } else {
        return `<svg class="rapid-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.97 14.63C11.07 14.63 10.1 13.9 10.47 12.4L11.5 8H12.5L13.53 12.37C13.9 13.9 12.9 14.64 11.96 14.64L11.97 14.63ZM12 22.5C6.77 22.5 2.5 18.23 2.5 13C2.5 7.77 6.77 3.5 12 3.5C17.23 3.5 21.5 7.77 21.5 13C21.5 18.23 17.23 22.5 12 22.5ZM12 19.5C16 19.5 18.5 17 18.5 13C18.5 9 16 6.5 12 6.5C8 6.5 5.5 9 5.5 13C5.5 17 8 19.5 12 19.5ZM10.5 5.23V1H13.5V5.23H10.5ZM15.5 2H8.5C8.5 0.3 8.93 0 12 0C15.07 0 15.5 0.3 15.5 2Z"></path></svg>`;
    }
}

function getImpactClass(avgDrop) {
    const drop = Math.abs(avgDrop) / 100;  // Convert to pawns
    if (drop >= 2.95) return 'impact-critical'; // Displays as 3.0 rounded
    if (drop >= 1.95) return 'impact-high'; // Displays as 2.0 rounded
    return 'impact-medium';
}

function getImpactCategory(avgDrop) {
    const drop = Math.abs(avgDrop) / 100;
    if (drop >= 3) return 'critical';
    if (drop >= 2) return 'high';
    return 'medium';
}
