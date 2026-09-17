# Personal Research Portfolio

A dynamic, responsive personal portfolio website for academic researchers, featuring automatic integration with Semantic Scholar API for publications and research data.

## 🌟 Features

- **Dynamic Publications**: Automatically fetches and displays publications from Semantic Scholar
- **Planet Journey**: The site reads as one flight from Earth to Neptune — on desktop you travel left to right between planets (wheel, arrow keys, swipe or the flight path in the navbar), on phones the same trip runs top to bottom. A rocket flies along with you.
- **Space-themed Design**: CSS-drawn rocket, Earth and planets on a deep-space sky, with each section on a "logbook" card
- **Responsive Layout**: Optimized for desktop, tablet, and mobile devices
- **Always a plain page underneath**: `prefers-reduced-motion`, the list-view toggle in the navbar and visitors without JavaScript get the original vertical site, so search engines and assistive technology see every section as before
- **Publication Filtering**: Advanced search, sort, and category filtering
- **Statistics Animation**: Real-time academic metrics display
- **Professional Sections**: Research, industry experience, organizations, and contact

## 🔧 Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **API Integration**: Semantic Scholar API
- **Animations**: CSS keyframes, Intersection Observer API
- **Icons**: Font Awesome
- **Responsive**: CSS Grid & Flexbox
- **Performance**: Lazy loading, caching, optimized assets

## 📚 Sections

1. **Hero Section**: Space-themed introduction with animated elements
2. **About**: Personal background and research interests
3. **Research**: Research focus areas and methodologies
4. **Publications**: Dynamic publication list with filtering and pagination
5. **Industry Experience**: Professional work history
6. **Organizations**: Academic societies and club activities
7. **Contact**: Contact form and social links

## 🚀 Quick Start

1. Clone this repository
2. Update the Semantic Scholar ID in `scholar-integration.js`:
   ```javascript
   constructor(semanticScholarId = 'YOUR_SEMANTIC_SCHOLAR_ID') {
   ```
3. Customize personal information in `index.html`
4. Update contact details and social links
5. Deploy to GitHub Pages or any web server

## 📖 Configuration

### Semantic Scholar Integration
- Find your Semantic Scholar profile URL
- Extract the author ID (number after `/author/`)
- Update the ID in `scholar-integration.js`

### Personal Information
- Update name, affiliation, and bio in `index.html`
- Modify research interests and experience sections
- Update contact information and social links

### Styling Customization
- Colors and themes can be modified in `styles.css`
- Hero section animations can be adjusted
- Responsive breakpoints can be customized

## 🔗 Live Demo

Visit the live site: [Your GitHub Pages URL]

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Feel free to fork this project and submit pull requests for improvements!

## 📞 Contact

- **Email**: niklas.bubeck@gmail.com
- **LinkedIn**: [Your LinkedIn Profile]
- **GitHub**: [Your GitHub Profile]

---

⭐ Star this repository if you found it helpful!