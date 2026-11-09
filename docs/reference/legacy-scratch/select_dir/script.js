const PROJECT_ROOT = '/home/selub/Documents/progs';

const fileInput = document.getElementById('fileInput');
const resultDiv = document.getElementById('result');

function calculatePath() {
    const files = fileInput.files;
    
    if (files.length === 0) {
        alert('Выберите файл!');
        return;
    }

    const firstFile = files[0];
    const relativePath = firstFile.webkitRelativePath; // Например: "zoog/start_screen.png"

    // 1. Извлекаем имя корневой папки проекта из относительного пути.
    // Обычно это первая часть пути до первого слеша.
    // Если путь "zoog/start_screen.png", то проект лежит в "zoog".
    let projectFolderName = '';
    if (relativePath.includes('/')) {
        projectFolderName = relativePath.split('/')[0];
    } else {
        // Если файл лежит прямо в корне выбранной папки, а выбранная папка была корнем проекта,
        // то relativePath будет просто "file.js".
        // В этом случае мы не знаем имя папки проекта, если только не сканировать диск.
        // Но для демо предположим, что имя папки проекта совпадает с первым компонентом или мы используем заглушку.
        // Однако, в твоем примере "zoog" было первым компонентом.
        projectFolderName = relativePath.split('/')[0]; 
    }

    // 2. Формируем полный путь к проекту
    // Логика: PROJECT_ROOT + "/" + projectFolderName
    const fullProjectPath = `${PROJECT_ROOT}/${projectFolderName}`;

    // 3. Выводим результат в точном формате
    const output = `Base dir from ENV: ${PROJECT_ROOT}
Recieved from browser: ${relativePath}
Full calculated path on server:
${fullProjectPath}`;

    resultDiv.textContent = output;
    resultDiv.classList.add('show');
}