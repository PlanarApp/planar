# Эталоны импорта (WK-6)

Все файлы **составлены вручную по документации экспорта сервиса**, а не выгружены из реальных аккаунтов: колонки и форматы дат
взяты из описаний ниже, данные выдуманы. Реальные выгрузки могут отличаться версией продукта и локалью — мастер импорта
поэтому даёт сопоставить колонки вручную.

Пользователи в данных: `alice@example.com` (email) и `bsmith` (login); `nobody@example.com` и `ghost` — заведомо неизвестные.

| файл | источник формата | что в файле |
|---|---|---|
| `clickup.csv` | ClickUp Help: «Export your Tasks» (Export to CSV) | 25 строк; Task ID, Task Name, Task Content, Status, Due Date (Unix, мс) + Due Date Text, Parent ID (2 подзадачи), Assignees и Tags в скобках `[a, b]`, Priority; строка 7 без названия, в строке 3 неизвестный исполнитель, в строке 2 перевод строки и кавычки в описании |
| `jira.csv` | Atlassian: «Export issues» → «Export CSV (all fields)» | 8 строк; Summary, Issue key, Issue id, Status, Priority (Highest…Lowest), Assignee, Created / Due date в формате `d/Mon/yy h:mm AM`, **повторяющийся столбец Labels**, Parent id (подзадачи указывают Issue id) |
| `linear.csv` | Linear Docs: «Exporting data» (Export issues to CSV) | 8 строк; ID, Title, Description (markdown), Status, Priority (No priority/Urgent/High/Medium/Low), Assignee, Labels, Created At (ISO), Due Date, Parent issue |
| `trello.json` | Trello Help: «Export data from a Trello board» (Print and export → Export as JSON) | доска с 3 списками, метками (одна без имени — берётся цвет), участниками, чек-листом и 5 карточками: одна в архиве, одна без названия |

## Ожидаемый результат импорта в пустой проект

| файл | строк | пропущено | задач |
|---|---|---|---|
| `clickup.csv` | 25 | 1 (строка 7: нет заголовка) | 24 |
| `jira.csv` | 8 | 0 | 8 |
| `linear.csv` | 8 | 0 | 8 |
| `trello.json` | 5 | 2 (архив, нет названия) | 3 |

Номер строки в отчёте: CSV — номер записи как в таблице (заголовок — строка 1), Trello — номер карточки.
